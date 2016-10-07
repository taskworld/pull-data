'use strict'

const Assert = require('assert')
const P = require('bluebird')
const Moment = require('moment')
const Mongo = require('./mongodb')

const Fs = require('fs')
P.promisifyAll(Fs)

const MONGO_URL = 'mongodb://admin:open@localhost/taskworld_enterprise_us?authSource=admin'

run()

function run () {
  return P.try(() => Mongo.connect(MONGO_URL))
  .then(() => {
    const args = require('minimist')(process.argv.slice(2))
    const command = args.export || args['some-other-command'] || 'export'

    switch (command) {
      case 'export':
        Assert(args.from, '--from')
        return exportDataFromMongoDb(Moment(args.from))
      default:
        printUsage()
    }
  })
  .catch(Assert.AssertionError, reason => {
    console.error(`\nMissing required argument ${reason.message}`)
    printUsage()
  })
  .catch(reason => console.error('Error:', reason))
  .finally(Mongo.close)
}

function printUsage () {
  console.log(`
  Usage: node export-tw-data.js
    --from      From date, e.g. 2016-07-01
  `)
}

function exportDataFromMongoDb (startDate) {
  console.log(`
  Exporting recently updated data:
  Start Date: ${startDate.format()}
  `)

  return Mongo
  .query(exportRecentlyUpdated, { startDate })
}

function * findStartAuditIdByStartDate (db, opts) {
  let max = 100
  let found = false
  let lastId = null

  while (!found && max--) {
    const where = { }
    if (lastId) where._id = { $lt: lastId }
    const [doc] = yield db.collection('audits')
    .find(where).sort({ _id: -1 }).limit(1).skip(50000).toArray()
    lastId = doc._id

    const created = Moment(doc.created)
    found = created.isBefore(opts.startDate)
    console.log('At audit date:', created.format('YYYY-MM-DD'))
  }

  console.log('Starting at audit id:', lastId.toString())
  return lastId
}

function getRecentlyUpdatedResources (db, fromAuditId) {
  const $match = {
    _id: { $gte: fromAuditId },
    event: { $nin: ['task:get-accessible-tasks'] }
  }
  const $project = { event: 1, space_id: 1, r1: 1, owner_id: 1 }
  const $group = {
    _id: {
      owner_id: '$owner_id',
      event: '$event',
      ref: '$r1'
    },
    event_count: { $sum: 1 }
  }
  const $sort = {
    '_id.owner_id': 1,
    event_count: -1
  }

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
  const auditId = yield * findStartAuditIdByStartDate(db, opts.startDate)
  const audits = yield getRecentlyUpdatedResources(db, auditId)
  console.log('Audits:')
  console.log(audits.slice(0, 3))

  const reportStep1 = audits.map(x => Object.assign({ count: x.event_count }, x._id))
  const reportStep2 = reportStep1.reduce((acc, x) => {
    if (!acc[x.owner_id]) {
      acc[x.owner_id] = {
        events: { }
      }
    }
    if (!acc[x.owner_id].events[x.event]) {
      acc[x.owner_id].events[x.event] = { }
    }
    if (x.ref) {
      acc[x.owner_id].events[x.event][x.ref] = x.count
    } else {
      acc[x.owner_id].events[x.event] = x.count
    }
    return acc
  }, { })

  const filename = `/tmp/tw-audit-data.json`
  console.log(`Creating ${filename} containing ${Object.keys(reportStep2).length} objects ..`)

  // Dump to JSON.
  Fs.writeFileSync(filename, JSON.stringify(reportStep2, null, 2))
}
