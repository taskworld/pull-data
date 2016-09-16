'use strict'

const P = require('bluebird')
const Fs = require('fs')
const Path = require('path')
const Moment = require('moment')
const S3 = require('../lib/s3')

const Util = require('../util')
const StringUtil = require('./stringUtils')

renderTaskworldReport('/tmp/weekly-stats.csv')

function createWeek () {
  return {
    users: 0,
    clicks: 0,
    signups: 0,
    cost: 0
  }
}

function renderTaskworldReport (weeklyCsvFile) {
  Util.readCsv(weeklyCsvFile)
  .then(weeklyRows => {
    const allWeeksMap = weeklyRows.reduce((acc, x) => {
      const week = x['ga:year'] + x['ga:week']
      acc[week] = 1
      return acc
    }, { })

    const allWeeks = Object.keys(allWeeksMap)
    allWeeks.sort()
    console.log(JSON.stringify(allWeeks, null, 2))

    const adGroups = weeklyRows.reduce((acc, x) => {
      const week = x['ga:year'] + x['ga:week']
      const adGroup = x['ga:adGroup']
      const source = x['ga:sourceMedium']

      const users = parseInt(x['ga:users'], 10)
      const clicks = parseInt(x['ga:adClicks'], 10)
      const signups = parseInt(x['ga:goal7Completions'], 10)
      const cost = parseFloat(x['ga:adCost'])

      if (!acc[adGroup]) {
        acc[adGroup] = { total: createWeek() }
        acc[adGroup].total.adGroup = adGroup
      }

      if (!acc[adGroup][week]) {
        acc[adGroup][week] = createWeek()
      }

      acc[adGroup][week].users += users
      acc[adGroup][week].clicks += clicks
      acc[adGroup][week].signups += signups
      acc[adGroup][week].cost += cost

      acc[adGroup].total.users += users
      acc[adGroup].total.clicks += clicks
      acc[adGroup].total.signups += signups
      acc[adGroup].total.cost += cost

      return acc
    }, { })

    const allWeekTotals = Object.keys(adGroups).reduce((acc, x) => {
      acc.push(adGroups[x].total)
      return acc
    }, [ ])

    allWeekTotals.sort((a, b) => {
      if (a.signups === b.signups) {
        if (a.clicks === b.clicks) {
          if (a.users === b.users) {
            return 1
          }
          return a.users < b.users ? 1 : -1
        }
        return a.clicks < b.clicks ? 1 : -1
      }
      return a.signups < b.signups ? 1 : -1
    })

    console.log(JSON.stringify(allWeekTotals.slice(0, 5), null, 2))
    // console.log(JSON.stringify(adGroups[1], null, 2))

    allWeekTotals.forEach(data => {
      const row = []
      const weekData = adGroups[data.adGroup]
      allWeeks.forEach(week => {
        row.push(week)
        if (weekData[week]) {
          row.push(
            weekData[week].users,
            weekData[week].clicks,
            weekData[week].signups,
            weekData[week].cost
          )
        } else {
          row.push(0, 0, 0, 0)
        }
      })
      console.log(
        StringUtil.padString(data.adGroup, 30),
        row.map(x => StringUtil.padString(x, 6)).join(' ')
      )
    })

    if (process.argv[2] === 'upload') {
      S3.uploadToS3(S3.createItem('test.html'))
      .then(res => {
        console.log('res=', res)
      })
    }
  })
}
