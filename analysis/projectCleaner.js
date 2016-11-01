'use strict'

const P = require('bluebird')
const Moment = require('moment')
const Mongo = require('../mongodb')
const { clean, listToMap } = require('./util')

const Fs = require('fs')
P.promisifyAll(Fs)

function * getInactiveProjectsReport (db, { workspace }) {
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

  const maxAge = Moment().subtract(2, 'months').startOf('day')

  const projects = yield getActiveProjectsForSpace(db, spaceId, maxAge.toDate())
  const projectIds = projects.map(x => x._id.toString())
  const readStats = yield getProjectReadStatsForSpace(db, spaceId, projectIds, maxAge.toDate())
  const readStatsWithMetadata = yield * getProjectCleanupMetadataForStats(db, readStats)

  console.log('Entries:', JSON.stringify(readStatsWithMetadata[0], null, 2))

  // const eventStats = yield getProjectStatsForSpace(db, spaceId)
  // const inactiveProjects = yield * cleanOutInactiveProjects(db, eventStats, maxAge)
  // inactiveProjects.forEach(x => {
  //   console.log(x.event_count, x.project.title, Moment(x.last_event).format('YYYY-MM-DD'))
  // })
}

function getActiveProjectsForSpace (db, spaceId, createdDate) {
  return db.collection('projects')
  .find({
    space_id: spaceId,
    created: { $lt: createdDate },
    is_deleted: false,
    is_archived: false,
    is_personal: false
  })
  .limit(1000)
  .project({ _id: 1, title: 1, created: 1 })
  .sort({ _id: -1 })
  .toArray()
}

function getUsers (db, userIds) {
  return db.collection('users')
  .find({ _id: { $in: userIds.map(Mongo.getObjectId) } })
  .limit(1000)
  .project({ email: 1, first_name: 1, last_name: 1 })
  .toArray()
}

function getTasklists (db, tasklistIds) {
  return db.collection('tasklists')
  .find({ _id: { $in: tasklistIds.map(Mongo.getObjectId) } })
  .limit(1000)
  .project({ title: 1, tasks: 1 })
  .toArray()
}

function getTasks (db, taskIds) {
  return db.collection('tasks')
  .find({ _id: { $in: taskIds.map(Mongo.getObjectId) } })
  .limit(1000)
  .project({ title: 1 })
  .toArray()
}

function * getProjectCleanupMetadataForStats (db, projectStats) {
  const projectIds = projectStats.map(x => x._id.project_id)

  const projects = yield db.collection('projects')
  .find({ _id: { $in: projectIds.map(Mongo.getObjectId) } })
  .limit(2000)
  .project({
    title: 1,
    created: 1,
    owner_id: 1,
    members: 1,
    tasklists: 1,
    start_date: 1,
    completed_date: 1
  })
  .toArray()
  const projectsMap = listToMap(projects)

  // Get user data
  const userIds = projects.reduce((acc, x) => (
    acc.concat(x.owner_id, x.members.map(y => y._id))
  ), [])
  const uniqueUserIds = [... new Set(userIds)]
  console.log('User ids (all)   :', userIds.length)
  console.log('User ids (unique):', uniqueUserIds.length)

  const userMap = listToMap(yield getUsers(db, uniqueUserIds))

  // Get tasklist data
  const tasklistIds = projects.reduce((acc, x) => acc.concat(x.tasklists), [])
  const uniqueTasklistIds = [... new Set(tasklistIds)]
  const tasklists = yield getTasklists(db, uniqueTasklistIds)
  const tasklistMap = listToMap(tasklists)

  // Get task data
  const taskIds = tasklists.reduce((acc, x) => acc.concat(x.tasks), [])
  const uniqueTaskIds = [... new Set(taskIds)]
  const taskMap = listToMap(yield getTasks(db, uniqueTaskIds))
  console.log(taskMap)

  // Add metadata
  return projectStats.map(x => {
    const p = projectsMap[x._id.project_id]
    p.owner = userMap[p.owner_id]
    p.members = p.members.map(y => userMap[y._id])
    p.tasklists = p.tasklists.map(y => {
      const tl = tasklistMap[y]
      const tasks = tl.tasks.map(z => {
        console.log('Task:', taskMap[z].title)
        return taskMap[z]
      })
      return tl
    })
    x.project = p
    return x
  })
}

function getProjectReadStatsForSpace (db, spaceId, projectIds, maxAge) {
  const $match = {
    space_id: spaceId,
    event: 'project:get-complete',
    r1: { $in: projectIds }
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
    last_event: -1
  }
  const $matchAge = { last_event: { $lt: maxAge } }

  return db.collection('audits')
  .aggregate([
    { $match },
    { $project },
    { $group },
    { $match: $matchAge },
    { $sort }
  ])
  .toArray()
}

module.exports = {
  getInactiveProjectsReport
}
