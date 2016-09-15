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
  return P.all([
    Util.readCsv('/tmp/adword-signups.csv'),
    Util.readCsv('/tmp/adword-stats.csv'),
    Util.readCsv('/tmp/adgroup-alltime-stats.csv'),
    Util.readCsv('/tmp/tw-data.csv')
  ])
  .spread((signupRows, statsRows, adGroupStatsRows, twRows) => {
    // Rock on !

    const emailToCustomerMap = getEmailToCustomerMap(twRows)
    console.log('Unique customers:', Object.keys(emailToCustomerMap).length)

    const adGroupToEmailMap = getAdGroupToEmailMap(signupRows)
    console.log('Emails unique:', Object.keys(_stats.emails).length)

    // const sourceMediumToCustomerMap = getSourceMediumToCustomerMap(signupRows, emailToCustomerMap)
    // console.log(JSON.stringify(sourceMediumToCustomerMap, null, 2))

    // Add all customers for which we don’t have signup stats !
    let missingSignupStats = 0
    Object.keys(emailToCustomerMap).forEach(x => {
      if (!_stats.emails[x]) {
        adGroupToEmailMap['(not set)'].push(x)
        ++missingSignupStats
      }
    })
    console.log('Customers missing signup stats:', missingSignupStats)

    let statsReport = {
      sources: { },
      month: { },
      adGroup: { }
    }

    statsReport = statsRows.reduce((acc, x) => {
      const month = x['ga:year'] + x['ga:month']
      const cost = parseFloat(x['ga:adCost'])
      const clicks = parseInt(x['ga:adClicks'], 10)
      const signups = parseInt(x['ga:goal7Completions'], 10)
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

    // console.log(JSON.stringify(statsReport, null, 2))

    statsReport = adGroupStatsRows.reduce((acc, x) => {
      const group = x['ga:adGroup']
      const cost = parseFloat(x['ga:adCost'])
      const clicks = parseInt(x['ga:adClicks'], 10)
      const signups = parseInt(x['ga:goal7Completions'], 10)
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

    calculateCustomerStats(statsReport)
    calculateAcquisitionCosts(statsReport)

    const example1 = Object.assign({ }, statsReport.adGroup['(not set)'])
    example1.customers = example1.customers.length
    console.log('Report example 1 (no AdGroup):')
    console.log(JSON.stringify(example1, null, 2))

    console.log('Total Licenses:', Object.keys(statsReport.month)
    .reduce((acc, x) => acc + statsReport.month[x].totalLicenses, 0))

    Fs.writeFileSync(
      '/tmp/ad-group-performance.json',
      JSON.stringify(statsReport, null, 2)
    )
  })
}

function calculateCustomerStats (statsReport) {
  // Sum licences for each AdGroup.
  Object.keys(statsReport.adGroup).forEach(adGroup => {
    const adGroupRef = statsReport.adGroup[adGroup]
    adGroupRef.customers.forEach(customer => {
      let m
      const licenses = parseInt(customer.licenses, 10)
      switch (customer.subscription) {

        case 'premium':
          const workspaceDate = Moment(customer.workspaceCreatedDate)
          const workspaceMonth = workspaceDate.format('YYYYMM')
          m = statsReport.month[workspaceMonth]
          if (!m) {
            m = statsReport.month[workspaceMonth] = createStatsEntry()
          }
          m.totalCustomers++

          m.totalLicenses += licenses
          adGroupRef.totalLicenses += licenses
          addWeekStat(statsReport, workspaceDate, 'totalLicenses', licenses)
          addWeekStat(adGroupRef, workspaceDate, 'totalLicenses', licenses)

          if (adGroup !== '(not set)') {
            m.licensesPaidMarketing += licenses
            adGroupRef.licensesPaidMarketing += licenses
            addWeekStat(statsReport, workspaceDate, 'licensesPaidMarketing', licenses)
            addWeekStat(adGroupRef, workspaceDate, 'licensesPaidMarketing', licenses)
          }
          break

        case 'canceled':
          const endDate = Moment(customer.subscriptionEndDate)
          const endMonth = endDate.format('YYYYMM')
          m = statsReport.month[endMonth]
          if (!m) {
            m = statsReport.month[endMonth] = createStatsEntry()
          }

          m.totalLicensesChurned += licenses
          adGroupRef.totalLicensesChurned += licenses
          addWeekStat(statsReport, endDate, 'totalLicensesChurned', licenses)
          addWeekStat(adGroupRef, endDate, 'totalLicensesChurned', licenses)

          if (adGroup !== '(not set)') {
            m.licensesPaidMarketingChurned += licenses
            adGroupRef.licensesPaidMarketingChurned += licenses
            addWeekStat(statsReport, endDate, 'licensesPaidMarketingChurned', licenses)
            addWeekStat(adGroupRef, endDate, 'licensesPaidMarketingChurned', licenses)
          }
          break
      }
    })
  })
}

function calcStats (e) {
  e.costPerSignupPaidMarketing = getNumber(e.totalCostPaidMarketing / e.signupsPaidMarketing)
  e.costPerLicensePaidMarketing = getNumber(e.totalCostPaidMarketing / e.licensesPaidMarketing)
  e.costPerLicenseAllChannels = getNumber(e.totalCostPaidMarketing / e.totalLicenses)
  e.conversionRateAllChannels = getNumber(e.totalLicenses / e.totalSignups * 100).toFixed(2)
  e.conversionRatePaidMarketing = getNumber(e.licensesPaidMarketing / e.signupsPaidMarketing * 100).toFixed(2)
  e.conversionRateUsers = getNumber(e.totalLicenses / e.totalUsers * 100).toFixed(2)
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
    licensesPaidMarketingChurned: 0
  }
}

function getEmailToCustomerMap (twRows) {
  return twRows.reduce((acc, x) => {
    const email = x['ownerEmail']
    if (!acc[email]) {
      acc[email] = []
    }
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

function getSourceMediumToCustomerMap (signupRows, emailToCustomerMap) {
  return signupRows.reduce((acc, x) => {
    const source = x['ga:sourceMedium']
    const email = x['ga:eventLabel']
    const customer = emailToCustomerMap[email]
    if (customer) {
      if (!acc[source]) {
        acc[source] = []
      }
      // console.log('customer', customer)
      acc[source] = acc[source].concat(customer)
    }
    return acc
  }, { })
}

function addWeekStat (entry, date, key, value) {
  // NOTE: Don’t do this for now.
  return
  // // Create a map holding week stats.
  // if (!entry.weeks) {
  //   entry.weeks = { }
  // }
  // const week = date.format('YYYY[_]WW')
  // let w = entry.weeks[week]
  // if (!w) {
  //   w = entry.weeks[week] = createStatsEntry()
  // }
  // w[key] += value
}
