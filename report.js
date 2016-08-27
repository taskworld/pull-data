'use strict'

const P = require('bluebird')
const Moment = require('moment')
const Util = require('./util')

const Argv = require('minimist')(process.argv.slice(2))
if (
  Argv.taskworld &&
  Argv.subscriptions &&
  Argv.signups
) {
  P.coroutine(basicReport)(Argv)
} else {
  console.log(`
  Usage: node report.js
    --taskworld       Path to Taskworld csv file.
    --subscriptions   Path to BrainTree subscriptions csv file.
    --signups         Path to GA signups via adwords csv file.
  `)
}

function * basicReport (opts) {
  console.log(`
  Generating basic report:
  Taskworld CSV file:               ${opts.taskworld}
  BrainTree subscriptions CSV file: ${opts.subscriptions}
  Google AdWords signups CSV file:  ${opts.signups}
  `)

  let tw = yield Util.readCsv(opts.taskworld)
  console.log(`Read ${tw.length} Taskworld membership rows.`)

  const subs = yield Util.readCsv(opts.subscriptions)
  console.log(`Read ${subs.length} BrainTree subscription rows.`)
  const subToSubs = createMap(subs, 'id')

  tw = attachSubscriptionData(tw, subToSubs)

  const signs = yield Util.readCsv(opts.signups)
  console.log(`Read ${signs.length} Google AdWord signup rows.`)
  const emailToSign = createMap(signs, 'ga:eventLabel')

  tw = attachSignupData(tw, emailToSign)

  // Sort it!
  tw.sort((a, b) => a.subscriptionStartDate > b.subscriptionStartDate ? -1 : 1)

  const reportFileName = '/tmp/combined.csv'
  yield Util.writeCsv(tw, reportFileName)
  console.log(`Created new combined report ${reportFileName}.`)
}

function createMap (arr, field) {
  return arr.reduce((acc, x) => {
    acc[x[field]] = x
    return acc
  }, { })
}

function attachSignupData (tw, signups) {
  return tw.map((x) => {
    const s = signups[x.ownerEmail]
    x.signupSource = ''
    x.signupDate = ''
    if (s) {
      x.signupSource = s['ga:adGroup']
      x.signupDate = Moment(s['ga:date'], 'YYYYMMDD').format('YYYY-MM-DD')
    }
    return x
  })
}

function attachSubscriptionData (tw, subToSubs) {
  return tw.map((x) => {
    const o = subToSubs[x.subscriptionId]

    x.subscriptionPrice = ''
    x.subscriptionPlanId = ''
    x.subscriptionFirstBillingDate = ''
    x.subscriptionCurrentBillingCycle = ''
    x.subscriptionStatus = ''
    if (o) {
      x.subscriptionPrice = o.price
      x.subscriptionPlanId = o.planId
      x.subscriptionFirstBillingDate = o.firstBillingDate
      x.subscriptionCurrentBillingCycle = o.currentBillingCycle
      x.subscriptionStatus = o.status
    }
    return x
  })
}
