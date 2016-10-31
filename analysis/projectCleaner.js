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

  const maxAge = Moment().subtract(2, 'months').toDate()
  const eventStats = yield getProjectStatsForSpace(db, spaceId)
  const inactiveProjects = yield * cleanOutInactiveProjects(db, eventStats, maxAge)
  inactiveProjects.forEach(x => {
    console.log(x.event_count, x.project.title, Moment(x.last_event).format('YYYY-MM-DD'))
  })
}

function * cleanOutInactiveProjects (db, eventStats, maxAge) {
  const projectIds = eventStats.map(x => x._id.project_id)

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
  getInactiveProjectsReport
}
