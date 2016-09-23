'use strict'

const P = require('bluebird')
const Fs = require('fs')
const Path = require('path')
const Moment = require('moment')
const Util = require('../util')
const Mongo = require('../mongodb')

Mongo.connect('mongodb://localhost/test')
.then(() => {
  analyzeUserBehavior('/tmp/ga-events.csv')
})

function * fetchTaskData (db, topTasks) {
  const lowActivityTaskIds = topTasks
  .filter(x => x.score <= 3)
  .map(x => Mongo.getObjectId(x.taskId))

  const lowActivityTasks = yield db.collection('tasks')
  .find({ _id: { $in: lowActivityTaskIds } })
  .sort({ _id: 1 })
  .toArray()

  const twoWeeksAgo = Moment().subtract(2, 'weeks')

  const needAttention = lowActivityTasks.reduce((acc, x) => {
    const created = x.created && Moment(x.created)
    const dueDate = x.due_date && Moment(x.due_date)
    const isDeleted = x.is_deleted === 1
    const isCompleted = x.status === 2

    // If created more than 2 weeks ago, and task isn’t completed nor deleted.
    if (created.isBefore(twoWeeksAgo) && !isCompleted && !isDeleted) {
      if (dueDate) {
        acc.dueDate.push(x)
      } else {
        acc.noDueDate.push(x)
      }
      // console.log(x.title)
      // console.log(`${created && created.format('YYYY-MM-DD')} / ${dueDate && dueDate.format('YYYY-MM-DD')} [${x.status}]`)
    }
    return acc
  }, {
    noDueDate: [],
    dueDate: []
  })
  console.log('needAttention', needAttention)
}

function analyzeUserBehavior (userCsvFile) {
  return Util.readCsv(userCsvFile)
  .then(rows => {
    const stats = rows.reduce((acc, x) => {
      acc.total += parseInt(x['ga:totalEvents'], 10)

      getPages(acc, x)
      getTasks(acc, x)

      return acc
    }, {
      total: 0,
      topPages: { },
      topTasks: { }
    })

    const topPages = Object.keys(stats.topPages).map(x => stats.topPages[x])
    topPages.sort((a, b) => a.visits < b.visits ? 1 : -1)
    stats.topPages = topPages.slice(0, 3)

    const topTasks = Object.keys(stats.topTasks).map(x => {
      const t = stats.topTasks[x]
      t.score = (t.comments * 8) + (t.updates * 4) + (t.open * 2) + (t.total * 1)
      return t
    })
    topTasks.sort((a, b) => a.score < b.score ? 1 : -1)
    stats.topTasks = topTasks

    // console.log('Stats:', stats)
    return Mongo.query(fetchTaskData, stats.topTasks)
    .then(Mongo.close)
    .catch((err) => console.error(err))
  })

  function getPages (acc, x) {
    const action = x['ga:eventAction']
    if (action.indexOf('route:') !== -1) {
      const page = action.substr(6)
      if (!acc.topPages[page]) {
        acc.topPages[page] = { visits: 0, name: page }
      }
      acc.topPages[page].visits++
    }
  }

  function newTask (taskId) {
    return {
      total: 0,
      comments: 0,
      updates: 0,
      open: 0,
      taskId
    }
  }

  function getTasks (acc, x) {
    const action = x['ga:eventAction']
    if (action.indexOf('message:task:create') !== -1) {
      const parts = x['ga:eventLabel'].split(':')
      if (parts[4] === 'TASKID') {
        const taskId = parts[5]
        if (!acc.topTasks[taskId]) {
          acc.topTasks[taskId] = newTask(taskId)
        }
        acc.topTasks[taskId].total++
        acc.topTasks[taskId].comments++
      }
    }

    if (action.indexOf('task:props') !== -1) {
      const parts = x['ga:eventLabel'].split(':')
      if (parts[4] === 'TID') {
        const taskId = parts[5]
        if (!acc.topTasks[taskId]) {
          acc.topTasks[taskId] = newTask(taskId)
        }
        acc.topTasks[taskId].total++
        acc.topTasks[taskId].updates++
      }
    }

    if (action === 'route:project') {
      const label = x['ga:eventLabel']
      const match = /task_id:([^:]+)/.exec(label)
      if (match) {
        const taskId = match[1]
        if (!acc.topTasks[taskId]) {
          acc.topTasks[taskId] = newTask(taskId)
        }
        acc.topTasks[taskId].total++
        acc.topTasks[taskId].open++
      }
    }

    if (action === 'page:project:kanban:create-task') {
      const parts = x['ga:eventLabel'].split(':')
      if (parts[4] === '_id') {
        const taskId = parts[5]
        if (!acc.topTasks[taskId]) {
          acc.topTasks[taskId] = newTask(taskId)
        }
        acc.topTasks[taskId].total++
      }
    }
  }
}
