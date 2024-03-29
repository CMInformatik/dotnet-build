const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const glob = require('@actions/glob');
const artifact = require('@actions/artifact');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Input variable names
const inputDockerPassword = 'docker-password';
const inputDockerUsername = 'docker-username';
const inputAppName = 'app-name';
const inputMyGetPreAuthUrl = 'myget-pre-auth-url';
const inputBuildConfiguration = 'build-configuration';
const inputDockerRegistry = 'docker-registry-url';
const inputPushToDocker = 'push-to-docker-registry';

let buildConfiguration = 'debug';
let dockerImage = '';
let tag = '';
let packageVersion = '';

async function run() {
    buildConfiguration = core.getInput(inputBuildConfiguration) ? core.getInput(inputBuildConfiguration) : 'debug';

    await runStep(addNuGetConfig, 'Add NuGet config.');
    await runStep(ensureMyGetNuGetSource, 'Ensure MyGet NuGet source.');
    await runStep(getPackageVersion, 'Loading package version');
    await runStep(setUpVersion, 'Prepare docker version.');
    await runStep(setUpDockerBuildX, 'SetUp docker buildX');
    await runStep(logInDockerRegistry, 'Login docker registry');

    try {
        await runStep(buildAndPush, 'Build and push docker container');
    }
    finally {
        await runStep(removeNuGetConfig, 'Remove NuGet config');
        await runStep(createExtractContainer, 'Create extract container');
        await runStep(extractBuildResult, 'Extract build result');
        await runStep(removeExtractContainer, 'Remove extract container');
    }

    await runStep(uploadArtifacts, 'Upload artifacts');
}

async function runStep(step, displayText) {
    try {
        console.log(`${displayText} started.`);

        await step();

        console.log(`${displayText} finished.`)
    } catch (error) {
        core.setFailed(`Step "${displayText}" failed. Error: ${error.message}`);
        throw error;
    }
}

async function getPackageVersion() {
    try {
        console.log("installing nbgv via dotnet tool");
        await exec.exec('dotnet tool install -g nbgv');
        console.log("done installing nbgv via dotnet tool");
    } catch (err) {
        console.log(`Error while installing nbgv: ${err}. We try to proceed anyway.`)
    }

    core.addPath(path.join(os.homedir(), '.dotnet', 'tools'));

    let versionJsonPath = undefined;
    let versionJsonDirectory = undefined;
    let versionJson = '';

    await exec.exec('find . -name "version.json"', [], { listeners: { stdout: (data) => { versionJsonPath = data.toString() } } });
    if (!versionJsonPath) {
        console.error('Version Json not found.');
    }

    await exec.exec(`dirname ${versionJsonPath}`, [], { listeners: { stdout: (data) => { versionJsonDirectory = `${data.toString()}` } } });
    versionJsonDirectory = versionJsonDirectory.replace(/(\r\n|\n|\r)/gm, '') + '/';

    await exec.exec(`nbgv get-version -p ${versionJsonDirectory}`);
    await exec.exec(`nbgv get-version -f json -p ${versionJsonDirectory}`, [], { listeners: { stdout: (data) => { versionJson += data.toString() } } });

    packageVersion = JSON.parse(versionJson)['CloudBuildAllVars']['NBGV_NuGetPackageVersion'];
    core.setOutput("version", packageVersion);

    let isPreRelease = false;
    if (packageVersion.includes('-')) {
        isPreRelease = true;
    }

    core.setOutput("is-pre-release", isPreRelease);
}

async function buildAndPush() {
    let dockerFile = undefined;

    await exec.exec('find . -name "Dockerfile"', [], { listeners: { stdout: (data) => { dockerFile = data.toString() } } });
    if (!dockerFile) {
        console.error('Dockerfile not found');
    }

    dockerFile = dockerFile.replace(/(\r\n|\n|\r)/gm, '');
    await exec.exec(`docker build . -f ${dockerFile} --secret id=nuget_config,src=/tmp/nuget.config --build-arg buildConfiguration:${buildConfiguration} -t ${tag} -t ${dockerImage}:${packageVersion} `);

    if (core.getBooleanInput(inputPushToDocker)) {
        await exec.exec(`docker push --all-tags ${dockerImage}`);
    }
}

async function extractBuildResult() {
    await exec.exec('docker cp extract:/app ./extracted-app');
}

async function createExtractContainer() {
    await exec.exec(`docker create --name extract "${tag}"`);
}

async function removeExtractContainer() {
    await exec.exec('docker rm extract');
}

async function logInDockerRegistry() {
    let password = core.getInput(inputDockerPassword);
    let username = core.getInput(inputDockerUsername);
    let dockerRegistry = core.getInput(inputDockerRegistry);

    await exec.exec(`docker login ${dockerRegistry} --username "${username}" --password "${password}"`);
}

async function setUpDockerBuildX() {
    await exec.exec('docker buildx install');
}

async function setUpVersion() {
    let repositoryName = core.getInput(inputAppName).toLowerCase();
    let dockerRegistry = core.getInput(inputDockerRegistry);
    let version = `edge`;
    
    dockerImage = `${dockerRegistry}/${repositoryName}`;

    if (github.context.ref.startsWith('refs/tags')) {
        version = github.context.ref.replace('refs/tags/', '');
    } else if (github.context.ref.startsWith('refs/heads/')) {
        version = github.context.ref.replace('refs/heads/', '').replace('/', '-');
    } else if (github.context.ref.startsWith('refs/pull/')) {
        const ev = JSON.parse(
            fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')
        );

        version = `pr-${ev.pull_request.number}`;
    }

    tag = `${dockerImage}:${version}`;
}

async function removeNuGetConfig() {
    await exec.exec('rm -f /tmp/nuget.config');
}

async function addNuGetConfig() {
    await exec.exec('dotnet new nugetconfig -o /tmp');
}

async function ensureMyGetNuGetSource() {
    let myGetNuGetSource = core.getInput(inputMyGetPreAuthUrl);
    if (myGetNuGetSource) {
        await exec.exec(`dotnet nuget add source "${myGetNuGetSource}" -n myget --configfile /tmp/nuget.config`)
    }
}

async function uploadArtifacts() {
    const globber = await glob.create('./extracted-app/**');
    const files = await globber.glob();
    const name = `${core.getInput(inputAppName)}-${packageVersion}`;

    await artifact.create().uploadArtifact(name, files, './extracted-app');
    core.setOutput("artifact-name", name);
}

run().then(_ => { });
