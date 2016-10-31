'use strict'

const P = require('bluebird')
const Moment = require('moment')
const Mongo = require('../mongodb')
const { clean, listToMap } = require('./util')

const Fs = require('fs')
P.promisifyAll(Fs)

function * getTaskOverviewReport (db, { workspace, email }) {
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

  const usersWhere = {
    _id: { $in: userIds.map(Mongo.getObjectId) },
    last_login: { $gte: maxAge }
  }
  if (email) {
    usersWhere.email = email
  }

  const users = yield db.collection('users')
  .find(usersWhere)
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

  const setTaskOnUser = (userId, taskId, value) => {
    if (userMap[userId]) {
      if (!userMap[userId].tasks) {
        userMap[userId].tasks = { }
      }
      if (userMap[userId].tasks[taskId]) {
        userMap[userId].tasks[taskId] += '/' + value
      } else {
        userMap[userId].tasks[taskId] = value
      }
    }
  }

  const taskMap = tasks.reduce((acc, task) => {
    const taskId = task._id.toString()
    task.title = clean(task.title)
    task.project = '[NO PROJECT]'
    task.tasklist = '[NO LIST]'

    const tasklist = taskToTasklistMap[task._id.toString()]
    if (tasklist) {
      task.tasklist = clean(tasklist.title)
      const project = projectMap[tasklist.project_id]
      if (project) {
        task.project = clean(project.title)
        task.project_id = tasklist.project_id
      }
    }

    acc[taskId] = task

    // Add tasks to users.
    setTaskOnUser(task.owner_id, taskId, 'owner')
    task.members.forEach(x => (
      setTaskOnUser(x._id, taskId, 'assignee')
    ))

    return acc
  })

  const report = Object.keys(userMap).reduce((acc, userId) => {
    const u = userMap[userId]
    acc[userId] = { projects: { }, user: u }
    if (u.tasks) {
      Object.keys(u.tasks).forEach(x => {
        const task = taskMap[x]
        task.ownership = u.tasks[x]
        task.date = Moment(task.created).format('YYYY-MM-DD')
        task.list = `${task.project} — ${task.tasklist}`
        if (!acc[userId].projects[task.project_id]) {
          acc[userId].projects[task.project_id] = []
        }
        acc[userId].projects[task.project_id].push(task)
      })
    }
    return acc
  }, { })

  printReport(report)

  function printReport (report) {
    Object.keys(report).forEach(userId => {
      const row = report[userId]
      console.log(`User: ${row.user.first_name} ${row.user.last_name} (${row.user.email})`)
      Object.keys(row.projects).forEach(projectId => {
        const tasks = row.projects[projectId]
        let count = 0
        Object.keys(tasks).forEach(taskId => {
          const task = tasks[taskId]
          if (count++ === 0) {
            console.log(`  ${task.list}`)
          }
          console.log(`   - ${task.title} (${task.date}, ${task.ownership})`)
        })
      })
    })
  }
  // ['project:get-complete']
  let eventStats = yield getProjectStatsForSpace(db, spaceId)
  eventStats = yield * cleanOutInactiveProjects(db, eventStats)
  eventStats.forEach(x => {
    console.log(x.event_count, x.project.title, Moment(x.last_event).format('YYYY-MM-DD'))
  })
}

function * cleanOutInactiveProjects (db, eventStats, maxAgeDays = 60) {
  const projectIds = eventStats.map(x => x._id.project_id)
  const maxAge = Moment().subtract(maxAgeDays, 'days')

  const projects = yield db.collection('projects')
  .find({
    _id: { $in: projectIds.map(Mongo.getObjectId) }
    // $or: [
    //   { is_deleted: true },
    //   { is_archived: true },
    //   { is_personal: true }
    // ]
  })
  .limit(2000)
  .project({
    title: 1,
    created: 1,
    is_archived: 1,
    is_deleted: 1,
    is_personal: 1
  })
  .toArray()
  const projectsMap = listToMap(projects)

  console.log('event stats before filtering projects:', eventStats.length)

  const inactiveProjects = eventStats
  .filter(x => {
    const p = projectsMap[x._id.project_id]
    if (!p) {
      console.log('BAD PROJECT!!!', x)
      return false
    }
    // Remove deleted, archived or personal projects.
    return !(p.is_deleted || p.is_archived || p.is_personal)
  })
  .filter(x => Moment(x.last_event).isBefore(maxAge))

  // Add some metadata !
  inactiveProjects.forEach(x => {
    x.project = projectsMap[x._id.project_id]
  })

  console.log('event stats after filtering projects: ', inactiveProjects.length)
  return inactiveProjects
}

function getProjectStatsForSpace (db, spaceId) {
  const $match = {
    space_id: spaceId,
    event: 'project:get-complete'
  }
  const $project = { event: 1, space_id: 1, r1: 1, owner_id: 1, created: 1 }
  const $group = {
    _id: {
      space_id: '$space_id',
      event: '$event',
      project_id: '$r1'
    },
    event_count: { $sum: 1 },
    last_event: { $max: '$created' }
  }
  const $sort = {
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

module.exports = {
  getTaskOverviewReport
}
