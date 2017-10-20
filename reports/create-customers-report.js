'use strict'

require('dotenv').load()

const P = require('bluebird')
const Fs = require('fs')
const Path = require('path')
const Moment = require('moment-timezone')
const S3 = require('../lib/s3')
const { resolveCountryFromUserData } = require('../lib/isoCountries')

const Util = require('../util')

const REAL_CUSTOMER_AFTER_SUBSCRIBED_DAYS = 45
const MAX_MONTHS = 6

Moment.tz.setDefault('America/Chicago') // CST

renderTaskworldReport(
  '/tmp/tw-data.csv',
  '/tmp/adword-signups.csv',
  '/tmp/adword-signups-device.csv'
)

function renderTaskworldReport (twCsvFile, adwordsCsvFile, deviceCsvFile) {
  return P.all([
    Util.readCsv(twCsvFile),
    Util.readCsv(adwordsCsvFile),
    Util.readCsv(deviceCsvFile)
  ])
  .spread(async (twRows, adwordsRows, deviceRows) => {
    const adMap = adwordsRows.reduce((acc, x) => {
      acc[x['ga:eventLabel']] = x
      return acc
    }, { })

    const deviceMap = deviceRows.reduce((acc, x) => {
      acc[x['ga:eventLabel']] = x
      return acc
    }, { })

    twRows.forEach((x) => {
      // Convert licenses to int.
      x.licenses = parseInt(x.licenses, 10)
      if (x.licenses > 1000) x.licenses = 50
      x.amount = parseFloat(x.amount) || 0.0

      const upgraded = parseFloat(x.upgraded) || 0.0
      if (upgraded > 1.0) {
        if (x.upgraded === x.currentPrice) {
          // Upgrade without discount, use upgraded price as the only amount.
          console.log(`Upgrade detected: ${x.amount} -> ${upgraded} ~= ${x.currentPrice} (requires refund)`)
          x.amount = upgraded
        } else if (upgraded < x.amount) {
          // Downgrade, don’t do anything.
        } else {
          // Upgrade with discount, add upgrade amount to base amount.
          console.log(`Upgrade detected: ${x.amount} + ${upgraded} ~= ${x.currentPrice}`)
          x.amount += upgraded
        }
      }

      x.country = x.signupCountry
      x.signupSource = x.utmSource
      x.channel = ''
      x.device = ''

      const source = adMap[x.ownerEmail]

      if (source) {
        if (source['ga:adGroup'] !== '(not set)') {
          x.signupSource = source['ga:adGroup'] + ': ' + source['ga:adMatchedQuery']
        }
        x.channel = source['ga:sourceMedium']
        x.country = source['ga:country']
      }

      resolveCountryFromUserData(x)

      const device = deviceMap[x.ownerEmail]
      if (device) {
        x.device = device['ga:deviceCategory']
      }

      x.membershipDays = Math.min(
        Moment(x.subscriptionEndDate).diff(Moment(x.subscriptionStartDate), 'days'),
        Moment().diff(Moment(x.subscriptionStartDate), 'days')
      )
      x.isActive = isActiveCustomer(x)

      x.editableField = {
        signupSource: !x.signupSource,
        channel: !x.channel,
        country: !x.country
      }
    })

    let html = Fs.readFileSync(Path.join(__dirname, 'layout-customer.html'), 'utf8')

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

    // Add average lifetime value
    getAverageLifetimeValue(report)

    // DUMP !
    // console.log(JSON.stringify(report.report.monthly, null, 2))

    html = html.replace('{{DATA}}', JSON.stringify(report, null, 2))

    if (process.env.NODE_ENV === 'dev') {
      html = html
      .replace('{{FIREBASESCRIPT}}', '')
      .replace('{{SCRIPT}}', '')
      .replace('{{DEVSCRIPT}}', '<script src="http://localhost:8080/app.bundle.js"></script>')
    } else {
      const content = Fs.readFileSync(Path.join(__dirname, '../bin/app.bundle.js'), 'utf8')
      html = html
      .replace('{{FIREBASESCRIPT}}', '')
      .replace('{{DEVSCRIPT}}', '')
      .replace('{{SCRIPT}}', () => content)
    }

    const reportFile = '/tmp/customer-report.html'
    Fs.writeFileSync(reportFile, html)
    if (process.argv[2] === 'upload') {
      S3.uploadToS3(S3.createItem(reportFile))
      .then(res => {
        console.log(res)
        const expiresMatch = /Expires=(\d+)/.exec(res.signedUrl)
        const expiresDate = new Date(parseInt(expiresMatch[1], 10) * 1000)
        console.log('res=', res)
        console.log(`=======================================\nExpires:`, expiresDate)
      })
    }
  })
}

function getAverageLicenseCost (twRows) {
  const s = twRows.reduce((acc, x) => {
    if (x.amount && x.licenses) {
      const licenses = x.licenses
      const subscriptionCost = getSubscriptionMontlyValue(x)
      const pricePerLicense = subscriptionCost / (licenses || 1)
      // console.log('pricePerLicense=', pricePerLicense, 'cost=', subscriptionCost, 'licenses=', licenses, 'amount=', x.amount, 'billingCycle=', x.billingCycle)

      acc.averageLicenseCost += pricePerLicense
      acc.licensesWithAmounts++
    }
    return acc
  }, {
    averageLicenseCost: 0,
    licensesWithAmounts: 0
  })
  return s.averageLicenseCost / (s.licensesWithAmounts || 1)
}

function getAverageLifetimeValue (report) {
  const currentMonth = Moment().month()
  const s = report.report.monthly.reduce((acc, x) => {
    const isCurrentMonth = Moment(x.start, 'YYYY-MM-DD').month() === currentMonth
    if (!isCurrentMonth) {
      acc.lifetimeValueMonthlyAverage += x.lifetimeValue
      acc.lifetimeValueOptimisticMonthlyAverage += x.lifetimeValueOptimistic
      if (x.lifetimeValue) {
        acc.lifetimeValueMonths++
      }
      if (x.lifetimeValueOptimistic) {
        acc.lifetimeValueOptimisticMonths++
      }
    }
    return acc
  }, Object.assign(report.report, {
    lifetimeValueMonthlyAverage: 0,
    lifetimeValueOptimisticMonthlyAverage: 0,
    lifetimeValueMonths: 0,
    lifetimeValueOptimisticMonths: 0
  }))
  s.lifetimeValueMonthlyAverage /= (s.lifetimeValueMonths || 1)
  s.lifetimeValueOptimisticMonthlyAverage /= (s.lifetimeValueOptimisticMonths || 1)
}

function getAverageChurnRates (report) {
  const currentMonth = Moment().month()
  const s = report.report.monthly.reduce((acc, x) => {
    const isCurrentMonth = Moment(x.start, 'YYYY-MM-DD').month() === currentMonth
    if (!isCurrentMonth) {
      acc.churnRateMonthlyAverage += x.churnRate
      acc.churnRateOptimisticMonthlyAverage += x.churnRateOptimistic
      if (x.churnRate) {
        acc.churnRateMonths++
      }
      if (x.churnRateOptimistic) {
        acc.churnRateOptimisticMonths++
      }
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
  .reduce((acc, x) => acc + x.licenses, 0)
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
  .reduce((acc, x) => acc + x.licenses, 0)
}

function getSubscriptionMontlyValue (x) {
  return x.amount / (x.billingCycle === 'annually' ? 12 : 1)
}

function getStatsForPeriod (startDate, endDate, twRows) {
  const activeCustomerRows = twRows
  .filter(isActiveCustomer)

  const activeCustomerRowsBeforePeriod = activeCustomerRows
  .filter(x => Moment(x.subscriptionStartDate).isBefore(startDate))

  const licensesBeforePeriod = activeCustomerRowsBeforePeriod
  .reduce((acc, x) => acc + x.licenses, 0)

  const licensesFromRealCustomersBeforePeriod = activeCustomerRowsBeforePeriod
  .filter(isRealCustomer)
  .reduce((acc, x) => acc + x.licenses, 0)

  const rowsInPeriod = twRows.filter(x => startedInPeriod(x, startDate, endDate))

  const licensesInPeriod = rowsInPeriod
  .reduce((acc, x) => acc + x.licenses, 0)

  const customersInPeriod = rowsInPeriod
  .length

  const customersInPeriodAccumulated = customersInPeriod + activeCustomerRowsBeforePeriod.length

  const churnedRowsInPeriod = twRows
  .filter(x => isChurnedCustomerInPeriod(x, startDate, endDate))

  const churnedLicensesInPeriod = churnedRowsInPeriod
  .reduce((acc, x) => acc + x.licenses, 0)

  const churnedLicensesFromRealCustomersInPeriod = churnedRowsInPeriod
  .filter(isRealCustomer)
  .reduce((acc, x) => acc + x.licenses, 0)

  const churnRate = licensesBeforePeriod ? (churnedLicensesInPeriod / licensesBeforePeriod) : 0
  const churnRateOptimistic = licensesFromRealCustomersBeforePeriod ? (churnedLicensesFromRealCustomersInPeriod / licensesFromRealCustomersBeforePeriod) : 0
  const monthlyRecurringRevenue = activeCustomerRows
  .filter(x => startedInPeriod(x, startDate, endDate))
  .reduce((acc, x) => acc + Math.round(getSubscriptionMontlyValue(x)), 0)

  const licensesInPeriodAccumulated = licensesInPeriod + licensesBeforePeriod

  let salesMonthlyTotal = 0
  let salesAnnualTotal = 0
  const monthlyRevenuesTotalInPeriod = rowsInPeriod
  .reduce((acc, x) => {
    const amount = Math.round(parseFloat(x.amount) || 0)
    if (x.billingCycle === 'annually') salesAnnualTotal += amount
    if (x.billingCycle === 'monthly') salesMonthlyTotal += amount
    return acc + amount
  }, 0)
  const salesMonthlyPercentage = Math.round(salesMonthlyTotal / monthlyRevenuesTotalInPeriod * 100)
  const salesAnnualPercentage = Math.round(salesAnnualTotal / monthlyRevenuesTotalInPeriod * 100)

  let lifetimeValue = 0
  let lifetimeValueOptimistic = 0
  if (churnRate > 0.005 && licensesInPeriod) {
    lifetimeValue = monthlyRecurringRevenue / licensesInPeriod / churnRate
    lifetimeValueOptimistic = monthlyRecurringRevenue / licensesInPeriod / churnRateOptimistic
  }

  const licensePriceInPeriod = licensesInPeriod ? (monthlyRecurringRevenue / licensesInPeriod) : 0
  const countries = getLicensesByTopCountries(rowsInPeriod)

  const debug = false
  if (debug) {
    console.log(`
    Churn rate in period ${startDate.format('YYYY-MM-DD')} - ${endDate.format('YYYY-MM-DD')}:
    =============================================
    Total:            ${churnedLicensesInPeriod} churned / ${licensesBeforePeriod} total licenses before period ~= ${churnRate}
    Optimistic:       ${churnedLicensesFromRealCustomersInPeriod} churned / ${licensesFromRealCustomersBeforePeriod} total licenses before period ~= ${churnRateOptimistic}
    MRR:              ${monthlyRecurringRevenue}
    LTV:              ${lifetimeValue}
    LTV (Optimistic): ${lifetimeValueOptimistic}

    Churned customers:
    `)
    churnedRowsInPeriod.forEach(x => {
      console.log(`  [${Moment(x.subscriptionEndDate).format('YYYY-MM-DD')}] - ${x.licenses} - ${x.workspaceDisplayName} / ${x.ownerName}`)
    })
  }

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
    monthlyRecurringRevenue,
    monthlyRevenuesTotalInPeriod,
    lifetimeValue,
    lifetimeValueOptimistic,
    licensePriceInPeriod,
    salesMonthlyTotal,
    salesAnnualTotal,
    salesMonthlyPercentage,
    salesAnnualPercentage,
    countries
  }
}

function getLicensesByTopCountries (rows) {
  let otherCount = 0

  const map = rows.reduce((acc, x) => {
    const country = x.country
    if (country) {
      if (!acc[country]) acc[country] = 0
      acc[country] += x.licenses
    } else {
      otherCount += x.licenses
    }
    return acc
  }, { })

  const sorted1 = Object.keys(map).map(x => [x, map[x]])
  sorted1.sort((a, b) => a[1] > b[1] ? -1 : 1)

  const sorted2 = sorted1.slice(0, 10)
  const restCount = sorted1.slice(10).reduce((acc, x) => acc + x[1], 0)
  sorted2.push(['Other', restCount + otherCount])

  return sorted2
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
