'use strict'

const Assert = require('assert')
const P = require('bluebird')
const Moment = require('moment')
const Mongo = require('../mongodb')

const Fs = require('fs')
P.promisifyAll(Fs)

function assertFileExists (file) {
  Assert.doesNotThrow(() => Fs.accessSync(file), `Missing required file ${file}`)
}

function * getTaskOverviewReport (db, { workspace }) {
  // Get workspaces.
  const spaces = yield db.collection('workspaces').find({
    display_name: new RegExp(workspace, 'i')
  })
  .limit(3)
  .toArray()
  if (!spaces.length) {
    return console.log('Could not find any matching workspaces for pattern:', workspace)
  }
  const space = spaces[0]
  const spaceId = space._id.toString()
  console.log('Found matching workspaces:', spaces.map(x => x.display_name))
  console.log(`Selected workspace: ${space.name} (${space.display_name})`)

  // Get users.
  const removedMembers = space.member_profiles.reduce((acc, x) => {
    if (x.is_removed) {
      acc[x._id] = 1
    }
    return acc
  }, { })

  const uniqueMembers = [ ...new Set([].concat([space.owner_id], space.admins, space.members)) ]
  console.log(`Found ${uniqueMembers.length} unique members.`)
  const userIds = uniqueMembers.filter(x => !removedMembers[x])
  console.log(`Found ${userIds.length} non-removed members.`)

  const maxAge = Moment().subtract(3, 'months').toDate()

  const users = yield db.collection('users').find({
    _id: { $in: userIds.map(Mongo.getObjectId) },
    last_login: { $gte: maxAge }
  })
  .limit(500)
  .project({
    email: 1,
    first_name: 1,
    last_name: 1,
    phone: 1,
    photo: 1,
    job_title: 1,
    department: 1,
    language: 1,
    time_zone: 1
  })
  .toArray()
  console.log(`Found ${users.length} active users.`)

  const userMap = listToMap(users)
  const activeUserIds = Object.keys(userMap)

  // Get tasks.
  const tasks = yield db.collection('tasks').find({
    status: { $ne: 2 },
    is_deleted: false,
    space_id: spaceId,
    $or: [
      { is_owner: { $in: activeUserIds } },
      { 'members._id': { $in: activeUserIds }, 'members.is_assignee': true }
    ],
    updated: { $gte: maxAge }
  })
  .limit(1000)
  .project({
    title: 1,
    members: 1,
    owner_id: 1,
    project_id: 1,
    created: 1,
    updated: 1,
    due_date: 1,
    start_date: 1
  })
  .sort({ _id: -1 })
  .toArray()

  console.log(`Found ${tasks.length} unfinished tasks.`)
  const taskIds = tasks.map(x => x._id.toString())

  // Get tasklists.
  const tasklists = yield db.collection('tasklists').find({
    space_id: spaceId,
    // project_id: { $in: projectIds },
    tasks: { $in: taskIds }
  })
  .limit(1000)
  .project({ title: 1, tasks: 1, project_id: 1 })
  .toArray()
  console.log(`Found ${tasklists.length} related tasklists.`)

  const taskToTasklistMap = tasklists.reduce((acc, tl) => {
    tl.tasks.forEach(taskId => {
      acc[taskId] = {
        project_id: tl.project_id,
        title: tl.title
      }
    })
    return acc
  }, { })

  // Get projects for tasklists.
  const projectIds = tasklists.map(x => x.project_id)
  const projects = yield db.collection('projects').find({
    _id: { $in: projectIds.map(Mongo.getObjectId) },
    space_id: spaceId
  })
  .limit(200)
  .project({ title: 1, members: 1 })
  .toArray()
  console.log(`Found ${projects.length} related projects.`)
  const projectMap = listToMap(projects)

  tasks.forEach(task => {
    task.title = clean(task.title)
    task.project = '[NO PROJECT]'
    task.tasklist = '[NO LIST]'

    const tasklist = taskToTasklistMap[task._id.toString()]
    if (tasklist) {
      task.tasklist = clean(tasklist.title)
      const project = projectMap[tasklist.project_id]
      if (project) {
        task.project = clean(project.title)
      }
    }

    // Add tasks to users.
    if (userMap[task.owner_id]) {
      if (!userMap[task.owner_id].owns) {
        userMap[task.owner_id].owns = []
      }
      userMap[task.owner_id].owns.push(task)
    }
    task.members.forEach(x => {
      if (userMap[x._id]) {
        if (!userMap[x._id].assigned) {
          userMap[x._id].assigned = []
        }
        userMap[x._id].assigned.push(task)
      }
    })
  })

  const getTaskData = (t) => {
    const date = Moment(t.created).format('YYYY-MM-DD')
    return {
      date,
      list: `${t.project} — ${t.tasklist}`,
      title: t.title
    }
  }

  const groupTasksByList = (map, tasks, tag) => {
    if (tasks) {
      tasks.forEach(t => {
        const d = getTaskData(t)
        if (tag) {
          Object.assign(d, tag)
        }
        if (!map[d.list]) {
          map[d.list] = []
        }
        map[d.list].push(d)
      })
    }
  }

  const report = Object.keys(userMap).reduce((acc, userId) => {
    const u = userMap[userId]
    acc[userId] = { }
    groupTasksByList(acc[userId], u.owns, { owner: true })
    groupTasksByList(acc[userId], u.assigned, { assignee: true })
    return acc
  }, { })

  console.log('Report:', JSON.stringify(report, null, 2))
}

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

function listToMap (list, id = '_id') {
  return list.reduce((acc, x) => {
    acc[x[id].toString()] = x
    return acc
  }, { })
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

function clean (str) {
  const re = /[\0-\x1F\x7F-\x9F\xAD\u0378\u0379\u037F-\u0383\u038B\u038D\u03A2\u0528-\u0530\u0557\u0558\u0560\u0588\u058B-\u058E\u0590\u05C8-\u05CF\u05EB-\u05EF\u05F5-\u0605\u061C\u061D\u06DD\u070E\u070F\u074B\u074C\u07B2-\u07BF\u07FB-\u07FF\u082E\u082F\u083F\u085C\u085D\u085F-\u089F\u08A1\u08AD-\u08E3\u08FF\u0978\u0980\u0984\u098D\u098E\u0991\u0992\u09A9\u09B1\u09B3-\u09B5\u09BA\u09BB\u09C5\u09C6\u09C9\u09CA\u09CF-\u09D6\u09D8-\u09DB\u09DE\u09E4\u09E5\u09FC-\u0A00\u0A04\u0A0B-\u0A0E\u0A11\u0A12\u0A29\u0A31\u0A34\u0A37\u0A3A\u0A3B\u0A3D\u0A43-\u0A46\u0A49\u0A4A\u0A4E-\u0A50\u0A52-\u0A58\u0A5D\u0A5F-\u0A65\u0A76-\u0A80\u0A84\u0A8E\u0A92\u0AA9\u0AB1\u0AB4\u0ABA\u0ABB\u0AC6\u0ACA\u0ACE\u0ACF\u0AD1-\u0ADF\u0AE4\u0AE5\u0AF2-\u0B00\u0B04\u0B0D\u0B0E\u0B11\u0B12\u0B29\u0B31\u0B34\u0B3A\u0B3B\u0B45\u0B46\u0B49\u0B4A\u0B4E-\u0B55\u0B58-\u0B5B\u0B5E\u0B64\u0B65\u0B78-\u0B81\u0B84\u0B8B-\u0B8D\u0B91\u0B96-\u0B98\u0B9B\u0B9D\u0BA0-\u0BA2\u0BA5-\u0BA7\u0BAB-\u0BAD\u0BBA-\u0BBD\u0BC3-\u0BC5\u0BC9\u0BCE\u0BCF\u0BD1-\u0BD6\u0BD8-\u0BE5\u0BFB-\u0C00\u0C04\u0C0D\u0C11\u0C29\u0C34\u0C3A-\u0C3C\u0C45\u0C49\u0C4E-\u0C54\u0C57\u0C5A-\u0C5F\u0C64\u0C65\u0C70-\u0C77\u0C80\u0C81\u0C84\u0C8D\u0C91\u0CA9\u0CB4\u0CBA\u0CBB\u0CC5\u0CC9\u0CCE-\u0CD4\u0CD7-\u0CDD\u0CDF\u0CE4\u0CE5\u0CF0\u0CF3-\u0D01\u0D04\u0D0D\u0D11\u0D3B\u0D3C\u0D45\u0D49\u0D4F-\u0D56\u0D58-\u0D5F\u0D64\u0D65\u0D76-\u0D78\u0D80\u0D81\u0D84\u0D97-\u0D99\u0DB2\u0DBC\u0DBE\u0DBF\u0DC7-\u0DC9\u0DCB-\u0DCE\u0DD5\u0DD7\u0DE0-\u0DF1\u0DF5-\u0E00\u0E3B-\u0E3E\u0E5C-\u0E80\u0E83\u0E85\u0E86\u0E89\u0E8B\u0E8C\u0E8E-\u0E93\u0E98\u0EA0\u0EA4\u0EA6\u0EA8\u0EA9\u0EAC\u0EBA\u0EBE\u0EBF\u0EC5\u0EC7\u0ECE\u0ECF\u0EDA\u0EDB\u0EE0-\u0EFF\u0F48\u0F6D-\u0F70\u0F98\u0FBD\u0FCD\u0FDB-\u0FFF\u10C6\u10C8-\u10CC\u10CE\u10CF\u1249\u124E\u124F\u1257\u1259\u125E\u125F\u1289\u128E\u128F\u12B1\u12B6\u12B7\u12BF\u12C1\u12C6\u12C7\u12D7\u1311\u1316\u1317\u135B\u135C\u137D-\u137F\u139A-\u139F\u13F5-\u13FF\u169D-\u169F\u16F1-\u16FF\u170D\u1715-\u171F\u1737-\u173F\u1754-\u175F\u176D\u1771\u1774-\u177F\u17DE\u17DF\u17EA-\u17EF\u17FA-\u17FF\u180F\u181A-\u181F\u1878-\u187F\u18AB-\u18AF\u18F6-\u18FF\u191D-\u191F\u192C-\u192F\u193C-\u193F\u1941-\u1943\u196E\u196F\u1975-\u197F\u19AC-\u19AF\u19CA-\u19CF\u19DB-\u19DD\u1A1C\u1A1D\u1A5F\u1A7D\u1A7E\u1A8A-\u1A8F\u1A9A-\u1A9F\u1AAE-\u1AFF\u1B4C-\u1B4F\u1B7D-\u1B7F\u1BF4-\u1BFB\u1C38-\u1C3A\u1C4A-\u1C4C\u1C80-\u1CBF\u1CC8-\u1CCF\u1CF7-\u1CFF\u1DE7-\u1DFB\u1F16\u1F17\u1F1E\u1F1F\u1F46\u1F47\u1F4E\u1F4F\u1F58\u1F5A\u1F5C\u1F5E\u1F7E\u1F7F\u1FB5\u1FC5\u1FD4\u1FD5\u1FDC\u1FF0\u1FF1\u1FF5\u1FFF\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2072\u2073\u208F\u209D-\u209F\u20BB-\u20CF\u20F1-\u20FF\u218A-\u218F\u23F4-\u23FF\u2427-\u243F\u244B-\u245F\u2700\u2B4D-\u2B4F\u2B5A-\u2BFF\u2C2F\u2C5F\u2CF4-\u2CF8\u2D26\u2D28-\u2D2C\u2D2E\u2D2F\u2D68-\u2D6E\u2D71-\u2D7E\u2D97-\u2D9F\u2DA7\u2DAF\u2DB7\u2DBF\u2DC7\u2DCF\u2DD7\u2DDF\u2E3C-\u2E7F\u2E9A\u2EF4-\u2EFF\u2FD6-\u2FEF\u2FFC-\u2FFF\u3040\u3097\u3098\u3100-\u3104\u312E-\u3130\u318F\u31BB-\u31BF\u31E4-\u31EF\u321F\u32FF\u4DB6-\u4DBF\u9FCD-\u9FFF\uA48D-\uA48F\uA4C7-\uA4CF\uA62C-\uA63F\uA698-\uA69E\uA6F8-\uA6FF\uA78F\uA794-\uA79F\uA7AB-\uA7F7\uA82C-\uA82F\uA83A-\uA83F\uA878-\uA87F\uA8C5-\uA8CD\uA8DA-\uA8DF\uA8FC-\uA8FF\uA954-\uA95E\uA97D-\uA97F\uA9CE\uA9DA-\uA9DD\uA9E0-\uA9FF\uAA37-\uAA3F\uAA4E\uAA4F\uAA5A\uAA5B\uAA7C-\uAA7F\uAAC3-\uAADA\uAAF7-\uAB00\uAB07\uAB08\uAB0F\uAB10\uAB17-\uAB1F\uAB27\uAB2F-\uABBF\uABEE\uABEF\uABFA-\uABFF\uD7A4-\uD7AF\uD7C7-\uD7CA\uD7FC-\uF8FF\uFA6E\uFA6F\uFADA-\uFAFF\uFB07-\uFB12\uFB18-\uFB1C\uFB37\uFB3D\uFB3F\uFB42\uFB45\uFBC2-\uFBD2\uFD40-\uFD4F\uFD90\uFD91\uFDC8-\uFDEF\uFDFE\uFDFF\uFE1A-\uFE1F\uFE27-\uFE2F\uFE53\uFE67\uFE6C-\uFE6F\uFE75\uFEFD-\uFF00\uFFBF-\uFFC1\uFFC8\uFFC9\uFFD0\uFFD1\uFFD8\uFFD9\uFFDD-\uFFDF\uFFE7\uFFEF-\uFFFB\uFFFE\uFFFF]/g
  return str.replace(re, ' ').trim()
}

module.exports = {
  assertFileExists,
  getWorkspaceData,
  getAuditsMetadata,
  exportRecentlyUpdated,
  getTaskOverviewReport
}
