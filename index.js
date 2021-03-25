const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');

async function run() {
    try {
        console.log('Setting variables');
        const myGetNuGetSource = core.getInput('myget-pre-auth-url');

        await addNugetConfig();
        await ensureMyGetNuGetSource(myGetNuGetSource);
        await prepare();
        await setUpDockerBuildX();
        await logInDockerRegistry();

    } catch (error) {
        core.setFailed(error.message);
    }
}

async function logInDockerRegistry() {
    let password = core.getInput('docker-password');
    let username = core.getInput('docker-username');

    await exec.exec(`winpty docker login --username "${username}" --password "${password}"`);
}

async function setUpDockerBuildX() {
    console.log('Set up docker buildx');
    await exec.exec('docker buildx install');
}

async function prepare() {
    let repositoryName = core.getInput('app-name').toLowerCase();
    let dockerImage = `registry.cmicloud.ch:4443/${repositoryName}`;
    let version = 'edge';

    let tags = `-t ${dockerImage}:${version}`;
    if(github.context.eventName === 'push') {
        tags += ` -t ${dockerImage}:${github.context.sha}`;
    }


    /* TODO Version */
}

async function addNugetConfig() {
    console.log('Add nuget.config');
    await exec.exec('dotnet new nugetconfig -o /tmp');
}

async function ensureMyGetNuGetSource(myGetNuGetSource) {
    console.log('Ensure MyGet NuGet Source');
    if(myGetNuGetSource) {
        await exec.exec(`dotnet nuget add source "${myGetNuGetSource}" -n myget --configfile /tmp/nuget.config`)
    }
}

run().then(_ => {});
