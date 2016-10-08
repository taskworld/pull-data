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

function getAuditedTasksMapForUser (userId, audits) {
  const data = audits[userId]
  return Object.keys(data.events).reduce((acc, x) => {
    if (x.indexOf('task:') === 0) {
      Object.assign(acc, data.events[x])
    }
    return acc
  }, { })
}

function getAuditedTasksMap (audits) {
  return Object.keys(audits).reduce((acc, userId) => {
    const data = audits[userId]
    Object.keys(data.events).forEach(event => {
      if (event.indexOf('task:') === 0) {
        Object.keys(data.events[event]).forEach(taskId => {
          if (!acc[taskId]) {
            acc[taskId] = { }
          }
          if (!acc[taskId][userId]) {
            acc[taskId][userId] = { }
          }
          acc[taskId][userId][event] = 1
        })
      }
    })
    return acc
  }, { })
}

function groupTasksByTouchedAndUntouched (userId, tasks, userTasks, auditedTasksMap) {
  return tasks.reduce((acc, task) => {
    const taskId = task._id.toString()

    let isTouchedByOtherUser = false
    if (auditedTasksMap[taskId]) {
      const isTouchedByThisUser = !!auditedTasksMap[taskId][userId]
      const isTouchedByAtLeastTwoUsers = Object.keys(auditedTasksMap[taskId]).length > 1
      if (!isTouchedByThisUser || (isTouchedByThisUser && isTouchedByAtLeastTwoUsers)) {
        isTouchedByOtherUser = true
      }
    }

    if (userTasks[taskId]) {
      acc.touched.push({ task, count: userTasks[taskId] })
    } else if (isTouchedByOtherUser) {
      acc.touchedByOthers.push({ task, userAudits: auditedTasksMap[taskId] })
    } else {
      acc.untouched.push(task)
    }
    return acc
  }, { touched: [], untouched: [], touchedByOthers: [] })
}

function printTaskReport (user, groupedTasks, userMap) {
  console.log(`
  Email:     ${user.email}
  Updated:   ${groupedTasks.touched.length} tasks.
  Others:    ${groupedTasks.touchedByOthers.length} tasks.
  Untouched: ${groupedTasks.untouched.length} tasks.
  `)

  if (groupedTasks.touched.length) {
    groupedTasks.touched.sort((a, b) => a.count < b.count ? 1 : -1)
    console.log('Top Tasks:')
    groupedTasks.touched.forEach(x => (
      console.log(`[${x.count}] ${x.task.title}`)
    ))
  }
  console.log(`\n`)

  if (groupedTasks.touchedByOthers.length) {
    console.log('Responses:')
    groupedTasks.touchedByOthers.forEach(x => {
      console.log(x.task.title)
      Object.keys(x.userAudits).forEach(userId => {
        const email = userMap[userId].email
        const events = Object.keys(x.userAudits[userId]).join(', ')
        console.log(`  ${email} [ ${events} ]`)
      })
      console.log(`\n`)
    })
  }
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

  const auditedTasksMap = getAuditedTasksMap(audits)
  const userMap = users.reduce((acc, x) => {
    acc[x._id.toString()] = x
    return acc
  }, { })

  // For each user, fetch owned resources and determine stuff that
  // requires the user’s attention (i.e. that they follow up).
  let max = 10
  for (const user of users) {
    const userId = user._id.toString()
    const tasks = yield getRecentNonCompletedTasksForUser(db, user)
    const userTasks = getAuditedTasksMapForUser(userId, audits)
    const groupedTasks = groupTasksByTouchedAndUntouched(userId, tasks, userTasks, auditedTasksMap)

    printTaskReport(user, groupedTasks, userMap)

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
