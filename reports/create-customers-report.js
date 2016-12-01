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
      x.isActive = isActiveCustomer(x)
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
        averagePurchaseTimeDays: getAveragePurchaseTimeDays(twRows).toFixed(2),
        averageLicenseCost: getAverageLicenseCost(twRows)
      },
      rows: twRows
    }
    // Add average churn rates
    getAverageChurnRates(report)

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

function getAverageLicenseCost (twRows) {
  const s = twRows.reduce((acc, x) => {
    if (x.amount && x.licenses) {
      const amount = parseFloat(x.amount)
      const licenses = parseInt(x.licenses, 10)
      const subscriptionCost = amount / (x.billingCycle === 'annually' ? 12 : 1)
      acc.averageLicenseCost += (subscriptionCost / (licenses || 1))
      acc.licensesWithAmounts++
    }
    return acc
  }, {
    averageLicenseCost: 0,
    licensesWithAmounts: 0
  })
  return s.averageLicenseCost / (s.licensesWithAmounts || 1)
}

function getAverageChurnRates (report) {
  const s = report.report.monthly.reduce((acc, x) => {
    acc.churnRateMonthlyAverage += x.churnRate
    acc.churnRateOptimisticMonthlyAverage += x.churnRateOptimistic
    if (x.churnRate) {
      acc.churnRateMonths++
    }
    if (x.churnRateOptimistic) {
      acc.churnRateOptimisticMonths++
    }
    return acc
  }, Object.assign(report.report, {
    churnRateMonthlyAverage: 0,
    churnRateOptimisticMonthlyAverage: 0,
    churnRateMonths: 0,
    churnRateOptimisticMonths: 0
  }))
  s.churnRateMonthlyAverage /= (s.churnRateMonths || 1)
  s.churnRateOptimisticMonthlyAverage /= (s.churnRateOptimisticMonths || 1)
}

function getTotalLicenses (twRows) {
  return twRows
  .filter(isActiveCustomer)
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)
}

function getMonthlyStatsSince (startMonth, numMonths, twRows) {
  console.log('Starting from month:', startMonth.format())
  const monthlyStats = []
  for (let i = 0; i <= numMonths; ++i) {
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

  calculateMonthToMonthGrowth(monthlyStats)

  return monthlyStats
}

function calculateMonthToMonthGrowth (monthlyStats) {
  let previous
  monthlyStats.forEach((x, i) => {
    x.monthlyRecurringRevenueGrowth = 0
    x.licensesInPeriodGrowth = 0
    x.customersInPeriodGrowth = 0

    if (previous && i !== monthlyStats.length - 1) {
      x.monthlyRecurringRevenueGrowth = (x.monthlyRecurringRevenue - previous.monthlyRecurringRevenue) / (previous.monthlyRecurringRevenue || 1) * 100
      x.licensesInPeriodGrowth = (x.licensesInPeriod - previous.licensesInPeriod) / (previous.licensesInPeriod || 1) * 100
      x.customersInPeriodGrowth = (x.customersInPeriod - previous.customersInPeriod) / (previous.customersInPeriod || 1) * 100
    }
    previous = x
  })
}

function getLicensesAfter (startDate, twRows) {
  return twRows
  .filter(isActiveCustomer)
  .filter(x => Moment(x.subscriptionStartDate).isAfter(startDate))
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)
}

function getStatsForPeriod (startDate, endDate, twRows) {
  const activeCustomerRows = twRows
  .filter(isActiveCustomer)

  const activeCustomerRowsBeforePeriod = activeCustomerRows
  .filter(x => Moment(x.subscriptionStartDate).isBefore(startDate))

  const licensesBeforePeriod = activeCustomerRowsBeforePeriod
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)

  const licensesFromRealCustomersBeforePeriod = activeCustomerRowsBeforePeriod
  .filter(isRealCustomer)
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)

  const licensesInPeriod = twRows
  .filter(x => startedInPeriod(x, startDate, endDate))
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)

  const customersInPeriod = twRows
  .filter(x => startedInPeriod(x, startDate, endDate))
  .length

  const customersInPeriodAccumulated = customersInPeriod + activeCustomerRowsBeforePeriod.length

  const churnedRowsInPeriod = twRows
  .filter(x => isChurnedCustomerInPeriod(x, startDate, endDate))

  const churnedLicensesInPeriod = churnedRowsInPeriod
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)

  const churnedLicensesFromRealCustomersInPeriod = churnedRowsInPeriod
  .filter(isRealCustomer)
  .reduce((acc, x) => acc + parseInt(x.licenses, 10), 0)

  const churnRate = licensesBeforePeriod ? (churnedLicensesInPeriod / licensesBeforePeriod) : 0
  const churnRateOptimistic = licensesFromRealCustomersBeforePeriod ? (churnedLicensesFromRealCustomersInPeriod / licensesFromRealCustomersBeforePeriod) : 0
  const monthlyRecurringRevenue = activeCustomerRows
  .filter(x => startedInPeriod(x, startDate, endDate))
  .reduce((acc, x) => {
    const amount = parseInt((x.amount || '0'), 10) / (x.billingCycle === 'annually' ? 12 : 1)
    return acc + Math.round(amount)
  }, 0)

  const licensesInPeriodAccumulated = licensesInPeriod + licensesBeforePeriod

  console.log(`
  Churn rate in period ${startDate.format('YYYY-MM-DD')} - ${endDate.format('YYYY-MM-DD')}:
  =============================================
  Total:      ${churnedLicensesInPeriod} churned / ${licensesBeforePeriod} total licenses before period ~= ${churnRate}
  Optimistic: ${churnedLicensesFromRealCustomersInPeriod} churned / ${licensesFromRealCustomersBeforePeriod} total licenses before period ~= ${churnRateOptimistic}
  MRR:        ${monthlyRecurringRevenue}

  Churned customers:
  `)
  churnedRowsInPeriod.forEach(x => {
    console.log(`  [${Moment(x.subscriptionEndDate).format('YYYY-MM-DD')}] - ${x.licenses} - ${x.workspaceDisplayName} / ${x.ownerName}`)
  })

  return {
    churnedLicensesInPeriod,
    churnedLicensesFromRealCustomersInPeriod,
    customersInPeriod,
    customersInPeriodAccumulated,
    licensesInPeriod,
    licensesInPeriodAccumulated,
    licensesBeforePeriod,
    churnRate,
    churnRateOptimistic,
    monthlyRecurringRevenue
  }
}

function isRealCustomer (x) {
  const subscriptionLengthInDays = Math.abs(Moment(x.subscriptionStartDate).diff(Moment(x.subscriptionEndDate), 'days'))
  return subscriptionLengthInDays >= REAL_CUSTOMER_AFTER_SUBSCRIBED_DAYS
}

function isChurnedCustomerInPeriod (x, startDate, endDate) {
  const active = _isActive(x)
  return active.isBefore(Moment()) && active.isBetween(startDate, endDate)
}

function startedInPeriod (x, startDate, endDate) {
  return Moment(x.subscriptionStartDate).isBetween(startDate, endDate)
}

function isChurnedCustomer (x) {
  return _isActive(x).isBefore(Moment())
}

function isActiveCustomer (x) {
  return _isActive(x).isAfter(Moment())
}

function _isActive (x) {
  return Moment(x.subscriptionEndDate).add(6, 'weeks')
}

function getAveragePurchaseTimeDays (twRows) {
  const rows = twRows
  .filter(isActiveCustomer)
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
