'use strict'

const P = require('bluebird')
const Moment = require('moment')
const Mongo = require('./mongodb')
const Util = require('./util')
const Fs = require('fs')
P.promisifyAll(Fs)

const MAX_DOCS = 250000

const Argv = require('minimist')(process.argv.slice(2))
if (Argv.from) {
  run(Argv)
} else {
  console.log(`
  Usage: node export-tw-data.js
    --from      From date, e.g. 2016-07-01
  `)
}

function run (args) {
  exportDataFromMongoDb(Moment(args.from))
}

function exportDataFromMongoDb (startDate) {
  console.log(`
  Exporting recently updated data:
  Start Date: ${startDate.format()}
  `)

  return Mongo.query(exportRecentlyUpdated, { startDate })
  .then(Mongo.close)
  .catch((err) => console.error(err))
}

function getRecentlyUpdatedResources (db, startDate) {
  const $match = {
    created: {
      $gte: startDate.toDate(),
      $lt: startDate.clone().add(1, 'day').toDate()
    }
  }
  const $project = { event: 1, space_id: 1, r1: 1, owner_id: 1, created: 1 }
  const $group = {
    _id: { space_id: '$space_id', owner_id: '$owner_id' },
    event_count: { $sum: 1 },
    events: { $addToSet: '$event' }
  }
  const $sort = { event_count: -1 }

  return db.collection('audits')
  .aggregate([
    { $match },
    { $project },
    { $group },
    { $sort }
  ])
  .toArray()
}

function * exportRecentlyUpdated (db, opts) {
  const audits = yield getRecentlyUpdatedResources(db, opts.startDate)
  console.log('Audits:', audits)
  return

  const exportFileName = `/tmp/tw-export.csv`
  console.log(`Creating ${exportFileName} with ${audits.length} rows ..`)

  // Dump to CSV.
  yield Util.writeCsv(audits, exportFileName)
}
