'use strict'

const P = require('bluebird')
const Fs = require('fs')
const Moment = require('moment')

const Util = require('../util')

renderAdStatsReport()

const _stats = {
  customersTotal: 0,
  emailsTotal: 0,
  emails: { },
  workspaces: { }
}

function renderAdStatsReport () {
  return P.props({
    signupRows: Util.readCsv('/tmp/adword-signups.csv'),
    adWordStatsRows: Util.readCsv('/tmp/adword-stats.csv'),
    adGroupStatsRows: Util.readCsv('/tmp/adgroup-alltime-stats.csv'),
    twRows: Util.readCsv('/tmp/tw-data.csv')
  })
  .then(opts => {
    // Rock on !
    let statsReport = {
      sources: { },
      month: { },
      adGroup: { }
    }

    calculateAdWordStats(opts, statsReport)
    calculateAdGroupStats(opts, statsReport)
    calculateCustomerStats(statsReport)
    calculateAcquisitionCosts(statsReport)
    calculateCountryTotals(statsReport)

    // Print a bunch of stuff to check we’re doing it right !
    printAdGroupExample('(not set)', statsReport)
    printAdGroupExample('Trello', statsReport)

    console.log('Total Licenses:', Object.keys(statsReport.month)
    .reduce((acc, x) => acc + statsReport.month[x].totalLicenses, 0))
    console.log('Total Licenses (sum all countries):', statsReport.licensesByCountry
    .reduce((acc, x) => acc + x[1], 0))
    console.log('Total Revenue (sum all countries):', statsReport.revenueByCountry
    .reduce((acc, x) => acc + x[1], 0))

    console.log(`\nReport example month 2016-11:`)
    console.log(JSON.stringify(statsReport.month['201611'], null, 2))

    // It’s a Done Deal.
    Fs.writeFileSync(
      '/tmp/marketing-performance-combined.json',
      JSON.stringify(statsReport, null, 2)
    )
  })
}

function calculateAdGroupStats (opts, statsReport) {
  const emailToCustomerMap = getEmailToCustomerMap(opts.twRows, opts.signupRows)
  console.log('Unique customers:', Object.keys(emailToCustomerMap).length)

  const adGroupToEmailMap = getAdGroupToEmailMap(opts.signupRows)
  console.log('Emails unique:', Object.keys(_stats.emails).length)

  // Add all customers for which we don’t have signup stats !
  let missingSignupStats = 0
  Object.keys(emailToCustomerMap).forEach(x => {
    if (!_stats.emails[x]) {
      adGroupToEmailMap['(not set)'].push(x)
      ++missingSignupStats
    }
  })
  console.log('Customers missing signup stats:', missingSignupStats)

  opts.adGroupStatsRows.reduce((acc, x) => {
    const group = x['ga:adGroup']
    const cost = parseFloat(x['ga:adCost'])
    const clicks = parseInt(x['ga:adClicks'], 10)
    const signups = parseInt(x['ga:goal7Completions'], 10) + parseInt(x['ga:goal9Completions'], 10)
    const users = parseInt(x['ga:users'], 10)
    if (!acc.adGroup[group]) {
      acc.adGroup[group] = createStatsEntry()
      acc.adGroup[group].customers = getCustomers(
        adGroupToEmailMap[group], emailToCustomerMap
      )
    }
    acc.adGroup[group].totalCostPaidMarketing += cost
    acc.adGroup[group].totalClicks += clicks
    acc.adGroup[group].totalSignups += signups
    acc.adGroup[group].totalUsers += users
    if (cost > 0) {
      acc.adGroup[group].signupsPaidMarketing += signups
    }
    return acc
  }, statsReport)
}

function calculateAdWordStats (opts, statsReport) {
  opts.adWordStatsRows.reduce((acc, x) => {
    const month = x['ga:year'] + x['ga:month']
    const cost = parseFloat(x['ga:adCost'])
    const clicks = parseInt(x['ga:adClicks'], 10)
    const signups = parseInt(x['ga:goal7Completions'], 10) + parseInt(x['ga:goal9Completions'], 10)
    const users = parseInt(x['ga:users'], 10)

    if (!acc.month[month]) {
      acc.month[month] = createStatsEntry()
    }
    acc.month[month].totalCostPaidMarketing += cost
    acc.month[month].totalClicks += clicks
    acc.month[month].totalSignups += signups
    acc.month[month].totalUsers += users
    if (cost > 0) {
      acc.month[month].signupsPaidMarketing += signups
    }
    return acc
  }, statsReport)
}

function printAdGroupExample (adGroupName, statsReport) {
  const e = Object.assign({ }, statsReport.adGroup[adGroupName])
  e.customers = e.customers.length
  console.log('Report example:', adGroupName)
  console.log(JSON.stringify(e, null, 2))
}

function calculateCountryTotals (statsReport) {
  // Sum licences for each country of each AdGroup.
  const c = { }

  Object.keys(statsReport.adGroup).forEach(adGroupName => {
    const adGroup = statsReport.adGroup[adGroupName]
    Object.keys(adGroup.licensesByCountry).forEach(countryName => {
      const licenses = adGroup.licensesByCountry[countryName] || 0
      const revenue = adGroup.revenueByCountry[countryName] || 0
      if (!c[countryName]) {
        c[countryName] = {
          licenses: 0,
          revenue: 0
        }
      }
      c[countryName].licenses += licenses
      c[countryName].revenue += revenue
    })
  })

  const licensesSorted = Object.keys(c).map(x => [x, c[x].licenses])
  licensesSorted.sort((a, b) => a[1] < b[1] ? 1 : -1)

  const revenueSorted = Object.keys(c).map(x => [x, c[x].revenue])
  revenueSorted.sort((a, b) => a[1] < b[1] ? 1 : -1)

  statsReport.licensesByCountry = licensesSorted
  statsReport.revenueByCountry = revenueSorted
}

function calculateCustomerStats (statsReport) {
  // Sum licences for each AdGroup.
  Object.keys(statsReport.adGroup).forEach(adGroupName => {
    const adGroup = statsReport.adGroup[adGroupName]
    adGroup.customers.forEach(customer => {
      let month
      const licenses = parseInt(customer.licenses, 10)
      const isActive = isActiveCustomer(customer)

      if (isActive) {
        // Is active.
        const workspaceDate = Moment(customer.workspaceCreatedDate)
        const workspaceMonth = workspaceDate.format('YYYYMM')
        month = statsReport.month[workspaceMonth]
        if (!month) {
          month = statsReport.month[workspaceMonth] = createStatsEntry()
        }
        month.totalCustomers++
        month.totalLicenses += licenses
        adGroup.totalCustomers++
        adGroup.totalLicenses += licenses

        // Calculate average license cost.
        if (customer.amount && licenses) {
          const amount = parseFloat(customer.amount)
          const subscriptionCost = amount / (customer.billingCycle === 'annually' ? 12 : 1)
          const costPerLicense = subscriptionCost / (licenses || 1)
          month.averageLicenseCost += costPerLicense
          month.licensesWithAmounts++
          adGroup.averageLicenseCost += costPerLicense
          adGroup.licensesWithAmounts++
          // Count revenue per country per month and AdGroup.
          if (!month.revenueByCountry[customer.country]) {
            month.revenueByCountry[customer.country] = 0
          }
          month.revenueByCountry[customer.country] += amount
          if (!adGroup.revenueByCountry[customer.country]) {
            adGroup.revenueByCountry[customer.country] = 0
          }
          adGroup.revenueByCountry[customer.country] += amount
        }

        // Count licenses per country per month and AdGroup.
        if (!month.licensesByCountry[customer.country]) {
          month.licensesByCountry[customer.country] = 0
        }
        month.licensesByCountry[customer.country] += licenses
        if (!adGroup.licensesByCountry[customer.country]) {
          adGroup.licensesByCountry[customer.country] = 0
        }
        adGroup.licensesByCountry[customer.country] += licenses

        if (adGroupName !== '(not set)') {
          month.licensesPaidMarketing += licenses
          adGroup.licensesPaidMarketing += licenses
        }
      } else {
        // Is churned.
        const endDate = Moment(customer.subscriptionEndDate)
        const endMonth = endDate.format('YYYYMM')
        month = statsReport.month[endMonth]
        if (!month) {
          month = statsReport.month[endMonth] = createStatsEntry()
        }

        month.totalLicensesChurned += licenses
        adGroup.totalLicensesChurned += licenses

        if (adGroupName !== '(not set)') {
          month.licensesPaidMarketingChurned += licenses
          adGroup.licensesPaidMarketingChurned += licenses
        }
      }
    })
  })
}

function isActiveCustomer (x) {
  return _isActive(x).isAfter(Moment())
}

function _isActive (x) {
  return x.billingCycle === 'monthly'
  ? Moment(x.subscriptionEndDate).add(1, 'month').add(10, 'days')
  : Moment(x.subscriptionEndDate).add(10, 'days')
}

function calcStats (e) {
  e.costPerSignupPaidMarketing = getNumber(e.totalCostPaidMarketing / e.signupsPaidMarketing)
  e.costPerLicensePaidMarketing = getNumber(e.totalCostPaidMarketing / e.licensesPaidMarketing)
  e.costPerLicenseAllChannels = getNumber(e.totalCostPaidMarketing / e.totalLicenses)
  e.conversionRateAllChannels = getNumber(e.totalLicenses / e.totalSignups * 100).toFixed(2)
  e.conversionRatePaidMarketing = getNumber(e.licensesPaidMarketing / e.signupsPaidMarketing * 100).toFixed(2)
  e.conversionRateUsers = getNumber(e.totalLicenses / e.totalUsers * 100).toFixed(2)
  e.averageLicenseCost = getNumber(e.averageLicenseCost / e.licensesWithAmounts)
}

function calculateAcquisitionCosts (statsReport) {
  Object.keys(statsReport.month).forEach(x => calcStats(statsReport.month[x]))
  Object.keys(statsReport.adGroup).forEach(x => calcStats(statsReport.adGroup[x]))
}

function getNumber (n) {
  return !Number.isNaN(n) && Number.isFinite(n) ? n : 0
}

function getCustomers (emails, emailToCustomerMap) {
  if (emails) {
    return emails
    .reduce((acc, email) => {
      const customers = emailToCustomerMap[email]
      if (customers) {
        customers.forEach(x => {
          // Guard against duplicate workspaces.
          if (_stats.workspaces[x.workspaceName]) {
            console.log('Duplicate workspace detected:', x.workspaceDisplayName)
          }
          _stats.workspaces[x.workspaceName] = x.workspaceDisplayName
        })
        acc = acc.concat(customers)
      }
      return acc
    }, [])
  }
  return []
}

function createStatsEntry () {
  return {
    totalCostPaidMarketing: 0,
    totalClicks: 0,
    totalSignups: 0,
    totalCustomers: 0,
    totalLicenses: 0,
    totalLicensesChurned: 0,
    totalUsers: 0,
    signupsPaidMarketing: 0,
    licensesPaidMarketing: 0,
    licensesPaidMarketingChurned: 0,
    averageLicenseCost: 0,
    licensesWithAmounts: 0,
    licensesByCountry: { },
    revenueByCountry: { }
  }
}

function getEmailToCustomerMap (twRows, signupRows) {
  const emailToCountryMap = signupRows.reduce((acc, x) => {
    acc[x['ga:eventLabel']] = x['ga:country']
    return acc
  }, { })

  return twRows.reduce((acc, x) => {
    const email = x['ownerEmail']
    if (!acc[email]) {
      acc[email] = []
    }
    x.country = emailToCountryMap[email] || 'unknown'
    acc[email].push(x)
    return acc
  }, { })
}

function getAdGroupToEmailMap (signupRows) {
  return signupRows.reduce((acc, x) => {
    const group = x['ga:adGroup']
    const email = x['ga:eventLabel']
    if (!acc[group]) {
      acc[group] = []
    }

    if (_stats.emails[email]) {
      console.log(`Duplicate email found: ${email} in group ${group} (already in group ${_stats.emails[email]}).`)
      if (_stats.emails[email] === '(not set)') {
        _stats.emails[email] = group
      }
    } else {
      _stats.emails[email] = group
      acc[group].push(email)
    }

    return acc
  }, { })
}
