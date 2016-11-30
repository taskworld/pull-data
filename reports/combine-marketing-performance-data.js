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

// HACK: Hardcoded campaigns to geos lookup.
const _campaigns = {
  '353481534': 'AU,NZ',
  '316136334': 'GLOBAL',
  '353475894': 'GB,IE',
  '668977347': 'CA',
  '351333654': 'US',
  '353482254': 'TH',
  '635558054': 'HK',
  '660546168': 'AE',
  '658745451': 'IN',
  '693549483': 'ES',
  '635558639': 'SA',
  '670384709': 'DE,AU,CH',
  '665343797': 'FR',
  '695256601': 'SE,DK,NO,FI',
  '619677960': 'SG',
  '657886988': 'US,GB,AU,NZ,SA,IE',
  '693547326': 'BR'
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

    // Print a bunch of stuff to check we’re doing it right !
    printAdGroupExample('(not set)', statsReport)
    printAdGroupExample('Trello', statsReport)

    console.log('Total Licenses:', Object.keys(statsReport.month)
    .reduce((acc, x) => acc + statsReport.month[x].totalLicenses, 0))

    const sumLicensesFromCampaigns = Object.keys(statsReport.month).reduce((acc, month) => {
      const m = statsReport.month[month]
      Object.keys(m.byCampaign).forEach(campaignLabel => {
        acc += m.byCampaign[campaignLabel].totalLicenses
      })
      return acc
    }, 0)
    console.log('Total Licenses (campaigns):', sumLicensesFromCampaigns)

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
    const campaignLabel = getCampaignLabel(x)

    if (!acc.adGroup[group]) {
      acc.adGroup[group] = createStatsEntry()
      acc.adGroup[group].byCampaign = { }
      acc.adGroup[group].customers = getCustomers(
        adGroupToEmailMap[group], emailToCustomerMap
      )
    }

    const m1 = acc.adGroup[group]
    if (!m1.byCampaign[campaignLabel]) {
      m1.byCampaign[campaignLabel] = createStatsEntry()
    }
    const m2 = m1.byCampaign[campaignLabel]

    // Stats per ad group.
    m1.totalCostPaidMarketing += cost
    m1.totalClicks += clicks
    m1.totalSignups += signups
    m1.totalUsers += users
    if (cost > 0) {
      m1.signupsPaidMarketing += signups
    }

    // Stats per ad group per campaign.
    m2.totalCostPaidMarketing += cost
    m2.totalClicks += clicks
    m2.totalSignups += signups
    m2.totalUsers += users
    if (cost > 0) {
      m2.signupsPaidMarketing += signups
    }

    return acc
  }, statsReport)
}

function getCampaignLabel (row) {
  if (!row) {
    return '[unknown campaign]'
  }
  const campaignId = typeof row === 'object' ? row['ga:adwordsCampaignID'] : row
  const label = _campaigns[campaignId] || '[unknown target]'
  return `${label} - ${campaignId}`
}

function calculateAdWordStats (opts, statsReport) {
  opts.adWordStatsRows.reduce((acc, x) => {
    const month = x['ga:year'] + x['ga:month']
    const cost = parseFloat(x['ga:adCost'])
    const clicks = parseInt(x['ga:adClicks'], 10)
    const signups = parseInt(x['ga:goal7Completions'], 10) + parseInt(x['ga:goal9Completions'], 10)
    const users = parseInt(x['ga:users'], 10)
    const campaignLabel = getCampaignLabel(x)

    if (!acc.month[month]) {
      acc.month[month] = createStatsEntry()
      acc.month[month].byCampaign = { }
    }

    const m1 = acc.month[month]
    if (!m1.byCampaign[campaignLabel]) {
      m1.byCampaign[campaignLabel] = createStatsEntry()
    }
    const m2 = m1.byCampaign[campaignLabel]

    // Stats per month.
    m1.totalCostPaidMarketing += cost
    m1.totalClicks += clicks
    m1.totalSignups += signups
    m1.totalUsers += users
    if (cost > 0) {
      m1.signupsPaidMarketing += signups
    }

    // Stats per month per campaign.
    m2.totalCostPaidMarketing += cost
    m2.totalClicks += clicks
    m2.totalSignups += signups
    m2.totalUsers += users
    if (cost > 0) {
      m2.signupsPaidMarketing += signups
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

function calculateCustomerStats (statsReport) {
  // Sum licences for each AdGroup.
  Object.keys(statsReport.adGroup).forEach(adGroupName => {
    const adGroup = statsReport.adGroup[adGroupName]
    adGroup.customers.forEach(customer => {
      let month
      const licenses = parseInt(customer.licenses, 10)
      const isActive = isActiveCustomer(customer)
      const campaignLabel = getCampaignLabel(customer.campaign)

      if (!adGroup.byCampaign[campaignLabel]) {
        adGroup.byCampaign[campaignLabel] = createStatsEntry()
      }

      if (isActive) {
        // Is active.
        const workspaceDate = Moment(customer.workspaceCreatedDate)
        const workspaceMonth = workspaceDate.format('YYYYMM')

        month = statsReport.month[workspaceMonth]
        if (!month) {
          month = statsReport.month[workspaceMonth] = createStatsEntry()
          month.byCampaign = { }
        }
        if (!month.byCampaign[campaignLabel]) {
          month.byCampaign[campaignLabel] = createStatsEntry()
        }

        // Total licenses for month.
        month.totalCustomers++
        month.totalLicenses += licenses
        adGroup.totalCustomers++
        adGroup.totalLicenses += licenses

        // Total licenses for campaign in month.
        month.byCampaign[campaignLabel].totalCustomers++
        month.byCampaign[campaignLabel].totalLicenses += licenses
        adGroup.byCampaign[campaignLabel].totalCustomers++
        adGroup.byCampaign[campaignLabel].totalLicenses += licenses

        // Calculate average license cost.
        if (customer.amount && licenses) {
          const amount = parseFloat(customer.amount)
          const subscriptionCost = amount / (customer.billingCycle === 'annually' ? 12 : 1)
          const costPerLicense = subscriptionCost / (licenses || 1)
          month.averageLicenseCost += costPerLicense
          month.licensesWithAmounts++
          adGroup.averageLicenseCost += costPerLicense
          adGroup.licensesWithAmounts++

          // Count monthly recurring revenue per campaign.
          month.byCampaign[campaignLabel].monthlyRecurringRevenue += subscriptionCost
          adGroup.byCampaign[campaignLabel].monthlyRecurringRevenue += subscriptionCost
        }

        if (adGroupName !== '(not set)') {
          month.licensesPaidMarketing += licenses
          adGroup.licensesPaidMarketing += licenses
          month.byCampaign[campaignLabel].licensesPaidMarketing += licenses
          adGroup.byCampaign[campaignLabel].licensesPaidMarketing += licenses
        }
      } else {
        // Is churned.
        const endDate = Moment(customer.subscriptionEndDate)
        const endMonth = endDate.format('YYYYMM')
        month = statsReport.month[endMonth]
        if (!month) {
          month = statsReport.month[endMonth] = createStatsEntry()
        }
        if (!month.byCampaign[campaignLabel]) {
          month.byCampaign[campaignLabel] = createStatsEntry()
        }

        month.totalLicensesChurned += licenses
        adGroup.totalLicensesChurned += licenses
        month.byCampaign[campaignLabel].totalLicensesChurned += licenses
        adGroup.byCampaign[campaignLabel].totalLicensesChurned += licenses

        if (adGroupName !== '(not set)') {
          month.licensesPaidMarketingChurned += licenses
          adGroup.licensesPaidMarketingChurned += licenses
          month.byCampaign[campaignLabel].licensesPaidMarketingChurned += licenses
          adGroup.byCampaign[campaignLabel].licensesPaidMarketingChurned += licenses
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
  ? Moment(x.subscriptionEndDate).add(6, 'weeks')
  : Moment(x.subscriptionEndDate).add(6, 'weeks')
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
  Object.keys(statsReport.month).forEach(x => {
    calcStats(statsReport.month[x])
    Object.keys(statsReport.month[x].byCampaign).forEach(y => calcStats(statsReport.month[x].byCampaign[y]))
  })
  Object.keys(statsReport.adGroup).forEach(x => {
    calcStats(statsReport.adGroup[x])
    Object.keys(statsReport.adGroup[x].byCampaign).forEach(y => calcStats(statsReport.adGroup[x].byCampaign[y]))
  })
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
    monthlyRecurringRevenue: 0
  }
}

function getEmailToCustomerMap (twRows, signupRows) {
  const emailToSignupInfoMap = signupRows.reduce((acc, x) => {
    acc[x['ga:eventLabel']] = {
      adGroup: x['ga:adGroup'],
      query: x['ga:adMatchedQuery'],
      source: x['ga:sourceMedium'],
      country: x['ga:country'],
      campaign: x['ga:adwordsCampaignID'],
      campaignCountry: _campaigns[x['ga:adwordsCampaignID']] || '(not set)'
    }
    return acc
  }, { })

  const signupInfoDefaults = {
    country: 'no signup data',
    campaign: 'no signup data',
    campaignCountry: ''
  }

  return twRows.reduce((acc, x) => {
    const email = x['ownerEmail']
    if (!acc[email]) {
      acc[email] = []
    }

    // Add signup info to Taskworld data.
    Object.assign(x, signupInfoDefaults, emailToSignupInfoMap[email] || { })

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
