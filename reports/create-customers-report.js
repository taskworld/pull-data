'use strict'

const P = require('bluebird')
const Fs = require('fs')
const Path = require('path')
const Moment = require('moment')
const S3 = require('../lib/s3')

const Util = require('../util')

const REAL_CUSTOMER_AFTER_SUBSCRIBED_DAYS = 45
const MAX_MONTHS = 6

renderTaskworldReport('/tmp/tw-data.csv', '/tmp/adword-signups.csv')

function renderTaskworldReport (twCsvFile, adwordsCsvFile) {
  return P.all([
    Util.readCsv(twCsvFile),
    Util.readCsv(adwordsCsvFile)
  ])
  .spread((twRows, adwordsRows) => {
    const adMap = adwordsRows.reduce((acc, x) => {
      acc[x['ga:eventLabel']] = x
      return acc
    }, { })

    twRows.forEach((x) => {
      x.signupSource = ''
      x.channel = ''
      x.country = ''
      const source = adMap[x.ownerEmail]
      if (source) {
        if (source['ga:adGroup'] !== '(not set)') {
          x.signupSource = source['ga:adGroup'] + ': ' + source['ga:adMatchedQuery']
        }
        x.channel = source['ga:sourceMedium']
        x.country = source['ga:country']
      }
      x.membershipDays = Math.min(
        Moment(x.subscriptionEndDate).diff(Moment(x.subscriptionStartDate), 'days'),
        Moment().diff(Moment(x.subscriptionStartDate), 'days')
      )
    })

    let html = Fs.readFileSync(Path.join(__dirname, 'layout.html'), 'utf8')

    let startMonth = Moment().subtract(MAX_MONTHS, 'months')
    if (startMonth.isBefore(Moment('2016-05-01'))) {
      startMonth = Moment('2016-05-01')
    }
    const report = {
      report: {
        monthly: getMonthlyStatsSince(startMonth, MAX_MONTHS, twRows),
        licensesThisWeek: getLicensesAfter(Moment().startOf('isoWeek'), twRows),
        licensesThisMonth: getLicensesAfter(Moment().startOf('month'), twRows),
        licensesTotal: getTotalLicenses(twRows),
        averagePurchaseTimeDays: getAveragePurchaseTimeDays(twRows).toFixed(2)
      },
      rows: twRows
    }
    console.log(JSON.stringify(report.report, null, 2))

    html = html
    .replace('{{DATA}}', JSON.stringify(report, null, 2))
    .replace('{{SCRIPT}}', Fs.readFileSync(Path.join(__dirname, 'customer-report-react.js'), 'utf8'))

    const reportFile = '/tmp/customer-report.html'
    Fs.writeFileSync(reportFile, html)

    if (process.argv[2] === 'upload') {
      S3.uploadToS3(S3.createItem(reportFile))
      .then(res => {
        console.log('res=', res)
      })
    }
  })
}

function getTotalLicenses (twRows) {
  return twRows
  .filter((x) => x.subscription === 'premium')
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)
}

function getMonthlyStatsSince (startMonth, numMonths, twRows) {
  console.log('Starting from month:', startMonth.format())
  const monthlyStats = []
  for (let i = 0; i < numMonths; ++i) {
    const start = startMonth.clone().add(i, 'months').startOf('month')
    const end = start.clone().endOf('month')
    if (start.isAfter(Moment())) {
      console.log('.. and we’re done.')
      break
    }

    const stats = getStatsForPeriod(start, end, twRows)
    monthlyStats.push(Object.assign({
      start: start.format('YYYY-MM-DD'),
      end: end.isAfter(Moment()) ? Moment().format('YYYY-MM-DD') : end.format('YYYY-MM-DD'),
      endOfLastPeriod: start.clone().subtract(1, 'second').format('YYYY-MM-DD')
    }, stats))
  }
  return monthlyStats
}

function getLicensesAfter (startDate, twRows) {
  return twRows
  .filter((x) => x.subscription === 'premium')
  .filter((x) => Moment(x.subscriptionStartDate).isAfter(startDate))
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)
}

function getStatsForPeriod (startDate, endDate, twRows) {
  const premiumRowsBeforePeriod = twRows
  .filter((x) => x.subscription === 'premium')
  .filter((x) => Moment(x.subscriptionStartDate).isBefore(startDate))

  const licensesBeforePeriod = premiumRowsBeforePeriod
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)

  const licensesFromRealCustomersBeforePeriod = premiumRowsBeforePeriod
  .filter((x) => (
    Math.abs(Moment(x.subscriptionStartDate)
    .diff(Moment(x.subscriptionEndDate), 'days')) >= REAL_CUSTOMER_AFTER_SUBSCRIBED_DAYS
  ))
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)

  const licensesInPeriod = twRows
  .filter((x) => x.subscription === 'premium')
  .filter((x) => Moment(x.subscriptionStartDate).isBetween(startDate, endDate))
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)

  const cancelledRowsInPeriod = twRows
  .filter((x) => x.subscription === 'canceled')
  .filter((x) => Moment(x.subscriptionEndDate).isBetween(startDate, endDate))

  const churnedLicensesInPeriod = cancelledRowsInPeriod
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)

  const churnedLicensesFromRealCustomersInPeriod = cancelledRowsInPeriod
  .filter((x) => (
    Math.abs(Moment(x.subscriptionStartDate)
    .diff(Moment(x.subscriptionEndDate), 'days')) >= REAL_CUSTOMER_AFTER_SUBSCRIBED_DAYS
  ))
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)

  console.log(`
  Churn rate in period ${startDate.format('YYYY-MM-DD')} - ${endDate.format('YYYY-MM-DD')}:
  Total:      ${churnedLicensesInPeriod} churned / ${licensesBeforePeriod} total licenses before period.
  Optimistic: ${churnedLicensesFromRealCustomersInPeriod} churned / ${licensesFromRealCustomersBeforePeriod} total licenses before period.
  `)
  return {
    churnedLicensesInPeriod,
    churnedLicensesFromRealCustomersInPeriod,
    licensesInPeriod,
    licensesBeforePeriod,
    churnRate: churnedLicensesInPeriod
      ? (churnedLicensesInPeriod / licensesBeforePeriod * 100).toFixed(2) : 0,
    churnRateOptimistic: churnedLicensesFromRealCustomersInPeriod
      ? (churnedLicensesFromRealCustomersInPeriod / licensesFromRealCustomersBeforePeriod * 100).toFixed(2) : 0
  }
}

function getAveragePurchaseTimeDays (twRows) {
  const rows = twRows
  .filter((x) => x.subscription === 'premium')
  .filter((x) => (
    Moment(x.subscriptionStartDate).isAfter(Moment('2016-05-01')) &&
    Moment(x.workspaceCreatedDate).isAfter(Moment('2016-05-01'))
  ))
  return rows
  .reduce((acc, x) => {
    const startDate = Moment(x.workspaceCreatedDate)
    const endDate = Moment(x.subscriptionStartDate)
    const duration = Moment.duration(endDate.diff(startDate))
    const days = duration.asDays()
    return acc + days
  }, 0) / rows.length
}