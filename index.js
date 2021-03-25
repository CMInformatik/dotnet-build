const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');

async function run() {
    try {
        console.log('Add nuget.config');
        await exec.exec('dotnet new nugetconfig -o /tmp');

        await exec.exec('echo test');
    } catch (error) {
        core.setFailed(error.message);
    }
  }

  run().then(_ => {});
