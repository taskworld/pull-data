'use strict'

const Assert = require('assert')
const P = require('bluebird')
const Moment = require('moment')
const Mongo = require('../mongodb')

const Fs = require('fs')
P.promisifyAll(Fs)

const L = require('./lib')

const AUDITS_EXPORT_FILE = '/tmp/tw-audit-data.json'
const MONGO_URL = 'mongodb://admin:open@localhost/taskworld_enterprise_us?authSource=admin'

run()

function run () {
  return P.try(() => Mongo.connect(MONGO_URL))
  .then(() => {
    const args = require('minimist')(process.argv.slice(2))

    if (args.export) {
      Assert(args.from, 'Missing argument --from')
      return exportDataFromMongoDb(Moment(args.from))
    }

    if (args.process) {
      L.assertFileExists(AUDITS_EXPORT_FILE)
      return postProcessAuditsData(AUDITS_EXPORT_FILE)
    }

    if (args.story) {
      Assert(args.workspace, 'Missing argument --workspace')
      Assert(args.email, 'Missing argument --email')
      return getWorkspaceStory(args)
    }

    printUsage()
  })
  .catch(Assert.AssertionError, reason => {
    console.error(`\n`, reason.message)
    printUsage()
  })
  .catch(reason => console.error('Error:', reason))
  .finally(Mongo.close)
}

function printUsage () {
  console.log(`
  Usage: node export-tw-data.js
    --export        Export audits data from Taskworld.
      --from        From date, e.g. 2016-07-01.

    --process       Post-process exported audits data.

    --story         Create a user story for a workspace.
      --workspace   Workspace name (pattern).
      --user        Email of user.
  `)
}

function getWorkspaceStory (opts) {
  console.log(`
  Creating user story.
  `)
  return Mongo
  .query(L.getWorkspaceData, opts)
}

function postProcessAuditsData (auditsFile) {
  console.log(`
  Post processing exported audits data:
  File: ${auditsFile}
  `)

  return Mongo
  .query(L.getAuditsMetadata, { auditsFile })
}

function exportDataFromMongoDb (startDate) {
  console.log(`
  Exporting recently updated data:
  Start Date: ${startDate.format()}
  `)

  return Mongo
  .query(L.exportRecentlyUpdated, { startDate, filename: AUDITS_EXPORT_FILE })
}
