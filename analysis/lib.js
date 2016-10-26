'use strict'

const P = require('bluebird')
const Moment = require('moment')
const Mongo = require('../mongodb')
const { listToMap, clean } = require('./util')

const Fs = require('fs')
P.promisifyAll(Fs)

function * getWorkspaceData (db, { workspace, email }) {
  const spaces = yield db.collection('workspaces').find({
    display_name: new RegExp(workspace, 'i')
  })
  .limit(10)
  .project({ name: 1, display_name: 1, owner_id: 1, membership_id: 1 })
  .toArray()
  if (!spaces.length) {
    return console.log('Could not find any matching workspaces for pattern:', workspace)
  }
  const space = spaces[0]
  const spaceId = space._id.toString()
  console.log('Found matching workspaces:', spaces.map(x => x.display_name))
  console.log(`Selected workspace: ${space.name} (${space.display_name})`)

  const [user] = yield db.collection('users').find({ email })
  .limit(1)
  .project({ email: 1 })
  .toArray()
  if (!user) {
    return console.log('Could not find a user with email:', email)
  }
  console.log('Found user:', user.email)
  const userId = user._id.toString()

  const actions = yield getUserActionsForSpace(db, {
    userId,
    spaceId,
    fromDate: Moment('2016-09-01').startOf('month').toDate(),
    toDate: Moment('2016-10-01').endOf('month').toDate(),
    weekly: true
  })
  // console.log('Actions:')
  actions.map(x => console.log(`${x._id} (${x.count})`))

  const actionsPerDate = actions.reduce((acc, x) => {
    if (!x._id) {
      return acc
    }
    const [date, topic, id] = x._id.split('/')
    if (!acc[date]) {
      acc[date] = { read: { }, update: { } }
      acc.order.push(date)
    }
    if (topic === 'task:get' || topic === 'task:get:comments') {
      if (!acc[date].read[id]) acc[date].read[id] = 0
      acc[date].read[id] += x.count
    } else if (topic.includes('task:')) {
      if (!acc[date].update[id]) acc[date].update[id] = 0
      acc[date].update[id] += x.count
    }
    return acc
  }, { order: [] })
  // console.log('Actions:', actionsPerDate)

  let tasksMap
  for (const date of actionsPerDate.order) {
    console.log('Date:', date)
    const readTasksMap = actionsPerDate[date].read
    const readTasks = Object.keys(readTasksMap).map(x => ({ id: x, count: readTasksMap[x] }))
    readTasks.sort((a, b) => a.count > b.count ? -1 : 1)

    tasksMap = listToMap(yield getTasksForSpace(db, {
      taskIds: readTasks.map(x => x.id),
      spaceId
    }))
    console.log('Top read Tasks:')
    readTasks.map(x => {
      const t = tasksMap[x.id]
      t.status = t.status === 2 ? 'complete' : 'ongoing'
      t.count = x.count
      return t
    })
    .filter(t => t.status === 'ongoing' && t.is_deleted !== true)
    .map(t => {
      console.log(` - ${t.title} (${t.count} times)`)
    })
  }
}

function getUserActionsForSpace (db, opts) {
  const $match = {
    created: { $gte: opts.fromDate, $lt: opts.toDate },
    owner_id: opts.userId,
    space_id: opts.spaceId,
    // Excludes !
    $nor: [
      { event: 'message:create', r3: 'channel' },
      { event: 'task:get-accessible-tasks' }
    ]
  }
  const format = opts.weekly ? 'W%U' : '%Y-%m-%d'
  const $project = {
    date: { $dateToString: { format, date: '$created' } },
    event: 1,
    r1: 1
  }
  const $group = {
    _id: { $concat: ['$date', '/', '$event', '/', '$r1'] },
    count: { $sum: 1 }
  }
  const $sort = { '_id': -1 }

  return db.collection('audits')
  .aggregate([
    { $match },
    { $project },
    { $group },
    { $sort },
    { $limit: 1000 }
  ])
  .toArray()
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

function getTasksForSpace (db, opts) {
  const where = {
    _id: { $in: opts.taskIds.map(Mongo.getObjectId) },
    space_id: opts.spaceId
  }
  if (opts.excludedProjectIds) {
    where.project_id = { $nin: opts.excludedProjectIds }
  }

  console.log(`Fetching tasks ..`)
  return db.collection('tasks')
  .find(where)
  .project({
    title: 1,
    created: 1,
    updated: 1,
    owner_id: 1,
    project_id: 1,
    due_date: 1,
    start_date: 1,
    completed_date: 1,
    status: 1,
    is_deleted: 1
  })
  .sort({ _id: -1 })
  .toArray()
}

function getOnboardingProjectsForSpace (db, spaceId) {
  const where = {
    space_id: spaceId,
    is_onboarding: true
  }

  return db.collection('projects')
  .find(where)
  .project({ _id: 1 })
  .toArray()
  .then(result => listToMap(result))
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
      console.log(clean(x.task.title))
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

function * findStartAuditIdByStartDate (db, opts) {
  let max = 100
  let found = false
  let lastId = null

  while (!found && max--) {
    const where = { }
    if (lastId) where._id = { $lt: lastId }
    const [doc] = yield db.collection('audits')
    .find(where).sort({ _id: -1 }).limit(1).skip(250000).toArray()
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

  console.log(`Creating ${opts.filename} containing ${Object.keys(reportStep2).length} objects ..`)

  // Dump to JSON.
  Fs.writeFileSync(opts.filename, JSON.stringify(reportStep2, null, 2))
}

module.exports = {
  getWorkspaceData,
  getAuditsMetadata,
  exportRecentlyUpdated,
  getOnboardingProjectsForSpace
}
