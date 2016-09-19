'use strict'

const P = require('bluebird')
const Fs = require('fs')
const Path = require('path')
const Moment = require('moment')
const S3 = require('../lib/s3')

const Util = require('../util')
// const StringUtil = require('./stringUtils')

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
    allWeeks.sort((a, b) => a < b ? 1 : -1)
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

    const allRows = []
    allWeekTotals.forEach(data => {
      const row = {
        adGroup: data.adGroup
      }
      const weekData = adGroups[data.adGroup]
      allWeeks.forEach(week => {
        if (weekData[week]) {
          row[`${week}_us`] = weekData[week].users
          row[`${week}_cl`] = weekData[week].clicks
          row[`${week}_si`] = weekData[week].signups
          row[`${week}_co`] = weekData[week].cost
          row[`${week}_cps`] = weekData[week].signups
            ? (weekData[week].cost / weekData[week].signups).toFixed(2)
            : 0
        } else {
          row[`${week}_us`] = 0
          row[`${week}_cl`] = 0
          row[`${week}_si`] = 0
          row[`${week}_co`] = 0
          row[`${week}_cps`] = 0
        }
      })
      allRows.push(row)
    })

    // Remove inactive AdGroups.
    const thisWeekCost = `${allWeeks[0]}_co`
    const lastWeekCost = `${allWeeks[1]}_co`
    const activeGroups = allRows.filter(x => {
      return x[thisWeekCost] > 0 && x[lastWeekCost] > 0
    })
    const somewhatActiveGroups = allRows.filter(x => {
      return (
        (x[thisWeekCost] > 0 && x[lastWeekCost] === 0) ||
        (x[thisWeekCost] === 0 && x[lastWeekCost] > 0)
      )
    })
    const inactiveGroups = allRows.filter(x => {
      return x[thisWeekCost] === 0 && x[lastWeekCost] === 0
    })

    console.log(`Found ${allRows.length} total rows.`)
    console.log(`Found ${activeGroups.length} active groups.`)
    console.log(`Found ${inactiveGroups.length} inactive groups.`)
    console.log(`Found ${somewhatActiveGroups.length} somewhat active groups.`)
    // console.log(JSON.stringify(report, null, 2))

    let html = Fs.readFileSync(Path.join(__dirname, 'weekly-layout.html'), 'utf8')

    // let headers = false
    const fields = Object.keys(activeGroups[0])
    let tableRows = activeGroups.concat(somewhatActiveGroups, inactiveGroups).map(x => {
      return fields.reduce((acc, field) => {
        acc.push(`<td>${x[field]}</td>`)
        return acc
      }, []).join('')
    })
    const cols = [ ...new Array(fields.length) ].map(() => '<col>').join('')
    const table = `
    <table>
      ${cols}
      <tr>${tableRows.join('</tr><tr>')}</tr>
    </table>
    `

    html = html
    .replace(
      '<div class="container-fluid"></div>',
      '<div class="container-fluid">' + table + '</div>'
    )
    Fs.writeFileSync('/tmp/test.html', html)

    return Util.writeCsv(
      activeGroups.concat(somewhatActiveGroups, inactiveGroups),
      '/tmp/adgroups-per-week.csv'
    )
  })
  .then(() => {
    if (process.argv[2] === 'upload') {
      console.log('Uploading report to S3 ..')
      S3.uploadToS3(S3.createItem('test.html'))
      .then(res => {
        console.log('res=', res)
      })
    }
  })
}
