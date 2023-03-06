const AWS = require('aws-sdk');
const core = require('@actions/core');
const config = require('./config');

const runnerVersion = '2.3.3.1'

// User data scripts are run as the root user
function buildUserDataScript(githubRegistrationToken, label, noRunner = false) {
  core.info(`Building user data script for ${config.input.ec2Os}`)
  if (noRunner) {
    core.info(`Does not require userdata to start runner.`)
    return []
  }

  if (config.input.ec2Os === 'windows') {
    if (config.input.runnerHomeDir) {
      // If runner home directory is specified, we expect the actions-runner software (and dependencies)
      // to be pre-installed in the AMI, so we simply cd into that directory and then start the runner
      return [
        '<powershell>',
        'mkdir actions-runner; cd actions-runner',
        `Invoke-WebRequest -Uri https://github.com/actions/runner/releases/download/v${runnerVersion}/actions-runner-win-x64-${runnerVersion}.zip -OutFile actions-runner-win-x64-${runnerVersion}.zip`,
        `Add-Type -AssemblyName System.IO.Compression.FileSystem ; [System.IO.Compression.ZipFile]::ExtractToDirectory("$PWD/actions-runner-win-x64-${runnerVersion}.zip", "$PWD")`,
        `./config.cmd --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --unattended`,
        './run.cmd',
        '</powershell>',
        '<persist>false</persist>',
      ]
    } else {
      return [
        '<powershell>',
        `cd "${config.input.runnerHomeDir}"`,
        `./config.cmd --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label} --unattended`,
        './run.cmd',
        '</powershell>',
        '<persist>false</persist>',
      ]
    }
  } else if (config.input.ec2Os === 'linux') {
    if (config.input.runnerHomeDir) {
      // If runner home directory is specified, we expect the actions-runner software (and dependencies)
      // to be pre-installed in the AMI, so we simply cd into that directory and then start the runner
      return [
        '#!/bin/bash',
        `cd "${config.input.runnerHomeDir}"`,
        'export RUNNER_ALLOW_RUNASROOT=1',
        `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}`,
        './run.sh',
      ];
    } else {
      return [
        '#!/bin/bash',
        'mkdir actions-runner && cd actions-runner',
        'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
        'curl -O -L https://github.com/actions/runner/releases/download/v2.286.0/actions-runner-linux-${RUNNER_ARCH}-2.286.0.tar.gz',
        'tar xzf ./actions-runner-linux-${RUNNER_ARCH}-2.286.0.tar.gz',
        'export RUNNER_ALLOW_RUNASROOT=1',
        `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}`,
        './run.sh',
      ];
    }
  } else {
    core.error('Not supported ec2-os.');
    return []
  }
}

async function startEc2Instance(label, githubRegistrationToken) {
  const ec2 = new AWS.EC2();

  // We don't want userdata/runner to be started. Our image has already a runner service started
  const userData = buildUserDataScript(githubRegistrationToken, label, true);

  var params;
  if (userData.length === 0) {
    params = {
      ImageId: config.input.ec2ImageId,
      InstanceType: config.input.ec2InstanceType,
      MinCount: 1,
      MaxCount: 1,
      SubnetId: config.input.subnetId,
      SecurityGroupIds: [config.input.securityGroupId],
      IamInstanceProfile: { Name: config.input.iamRoleName },
      TagSpecifications: config.tagSpecifications,
    };
  } else {
    params = {
      ImageId: config.input.ec2ImageId,
      InstanceType: config.input.ec2InstanceType,
      MinCount: 1,
      MaxCount: 1,
      UserData: Buffer.from(userData.join('\n')).toString('base64'),
      SubnetId: config.input.subnetId,
      SecurityGroupIds: [config.input.securityGroupId],
      IamInstanceProfile: { Name: config.input.iamRoleName },
      TagSpecifications: config.tagSpecifications,
    };
  }


  try {
    const result = await ec2.runInstances(params).promise();
    const ec2InstanceId = result.Instances[0].InstanceId;
    core.info(`AWS EC2 instance ${ec2InstanceId} is started`);
    return ec2InstanceId;
  } catch (error) {
    core.error('AWS EC2 instance starting error');
    throw error;
  }
}

async function terminateEc2Instance() {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: [config.input.ec2InstanceId],
  };

  try {
    await ec2.terminateInstances(params).promise();
    core.info(`AWS EC2 instance ${config.input.ec2InstanceId} is terminated`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${config.input.ec2InstanceId} termination error`);
    throw error;
  }
}

async function waitForInstanceRunning(ec2InstanceId) {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: [ec2InstanceId],
  };

  try {
    await ec2.waitFor('instanceRunning', params).promise();
    core.info(`AWS EC2 instance ${ec2InstanceId} is up and running`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${ec2InstanceId} initialization error`);
    throw error;
  }
}

module.exports = {
  startEc2Instance,
  terminateEc2Instance,
  waitForInstanceRunning,
};
