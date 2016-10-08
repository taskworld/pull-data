'use strict'

const Assert = require('assert')
const P = require('bluebird')
const Moment = require('moment')
const Mongo = require('./mongodb')

const Fs = require('fs')
P.promisifyAll(Fs)

const AUDITS_EXPORT_FILE = '/tmp/tw-audit-data.json'
const MONGO_URL = 'mongodb://admin:open@localhost/taskworld_enterprise_us?authSource=admin'

run()

function assertFileExists (file) {
  Assert.doesNotThrow(() => Fs.accessSync(file), `Missing required file ${file}`)
}

function run () {
  return P.try(() => Mongo.connect(MONGO_URL))
  .then(() => {
    const args = require('minimist')(process.argv.slice(2))

    if (args.export) {
      Assert(args.from, 'Missing argument --from')
      return exportDataFromMongoDb(Moment(args.from))
    }

    if (args.process) {
      assertFileExists(AUDITS_EXPORT_FILE)
      return postProcessAuditsData(AUDITS_EXPORT_FILE)
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
    --export    Export audits data from Taskworld.
      --from    From date, e.g. 2016-07-01

    --process   Post-process exported audits data.
  `)
}

function postProcessAuditsData (auditsFile) {
  console.log(`
  Post processing exported audits data:
  File: ${auditsFile}
  `)

  return Mongo
  .query(getAuditsMetadata, { auditsFile })
}

function getRecentNonCompletedTasksForUser (db, user) {
  const where = {
    space_id: { $in: user.spaces },
    owner_id: user._id.toString(),
    is_deleted: false,
    status: { $ne: 2 },
    created: { $gte: Moment().subtract(90, 'days').toDate() }
  }

  console.log(`Fetching tasks from ${user.spaces.length} spaces for user ${user.email}.`)

  return db.collection('tasks')
  .find(where)
  .project({ title: 1, created: 1, updated: 1 })
  .sort({ _id: -1 })
  .toArray()
}

function getAuditedTasksMap (userId, audits) {
  const data = audits[userId]
  return Object.keys(data.events).reduce((acc, x) => {
    if (x.indexOf('task:') === 0) {
      Object.assign(acc, data.events[x])
    }
    return acc
  }, { })
}

function groupTasksByTouchedAndUntouched (tasks, auditedTasks) {
  return tasks.reduce((acc, task) => {
    const taskId = task._id.toString()
    if (auditedTasks[taskId]) {
      acc.touched[taskId] = task
    } else {
      acc.untouched[taskId] = task
    }
    return acc
  }, { touched: { }, untouched: { } })
}

function * getAuditsMetadata (db, { auditsFile }) {
  const audits = require(auditsFile)

  const userIds = Object.keys(audits)
  const users = yield db.collection('users').find({
    _id: { $in: userIds.map(Mongo.getObjectId) }
  })
  .project({ spaces: 1, email: 1 })
  .toArray()
  console.log(`Found ${users.length} users.`)

  // For each user, fetch owned resources and determine stuff that
  // requires the user’s attention (i.e. that they follow up).
  let max = 10
  for (const user of users) {
    const tasks = yield getRecentNonCompletedTasksForUser(db, user)
    const auditedTasks = getAuditedTasksMap(user._id.toString(), audits)
    const groupedTasks = groupTasksByTouchedAndUntouched(tasks, auditedTasks)

    console.log(
    `Found ${Object.keys(groupedTasks.touched).length} / ` +
    `${Object.keys(groupedTasks.untouched).length} touched tasks ` +
    `for user ${user.email}.`
    )

    if (!--max) {
      break
    }
  }
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
      space_id: '$space_id',
      owner_id: '$owner_id',
      event: '$event',
      ref: '$r1'
    },
    event_count: { $sum: 1 },
    spaces: { $addToSet: '$space_id' }
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

  const reportStep1 = audits.map(x => Object.assign({
    count: x.event_count,
    spaces: x.spaces
  }, x._id))
  const reportStep2 = reportStep1.reduce((acc, x) => {
    if (!acc[x.owner_id]) {
      acc[x.owner_id] = {
        spaces: x.spaces,
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

  console.log(`Creating ${AUDITS_EXPORT_FILE} containing ${Object.keys(reportStep2).length} objects ..`)

  // Dump to JSON.
  Fs.writeFileSync(AUDITS_EXPORT_FILE, JSON.stringify(reportStep2, null, 2))
}
