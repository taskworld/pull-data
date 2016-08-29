'use strict'

const Moment = require('moment')
const Assert = require('assert')
const Braintree = require('braintree')
const Util = require('./util')

Assert(process.env.PULLDATA_BRAINTREE_MERCHANT_ID, 'Missing env `PULLDATA_BRAINTREE_MERCHANT_ID`')
Assert(process.env.PULLDATA_BRAINTREE_KEY, 'Missing env `PULLDATA_BRAINTREE_KEY`')
Assert(process.env.PULLDATA_BRAINTREE_PRIVATE_KEY, 'Missing env `PULLDATA_BRAINTREE_PRIVATE_KEY`')

const Argv = require('minimist')(process.argv.slice(2))

if (Argv.subscriptions) {
  getSubscriptions()
} else if (Argv.transactions) {
  const fromDate = Argv.from && Moment(Argv.from, 'YYYY-MM-DD') || Moment().startOf('month')
  getTransactions(fromDate)
} else {
  console.log(`
  Usage: node fetch-tw-data.js
    --subscriptions       Fetch all subscriptions from BrainTree
    --transactions        Fetch transactions from BrainTree
      [--from]            Date from which to fetch transactions, e.g. 2016-08-01
  `)
}

function getGateway () {
  return Braintree.connect({
    environment: Braintree.Environment.Production,
    merchantId: process.env.PULLDATA_BRAINTREE_MERCHANT_ID,
    publicKey: process.env.PULLDATA_BRAINTREE_KEY,
    privateKey: process.env.PULLDATA_BRAINTREE_PRIVATE_KEY
  })
}

function getTransactions (fromDate) {
  console.log('Fetching transactions since', fromDate.format())

  const filter = (f) => {
    f.createdAt().min(fromDate.toDate())
  }

  const stream = getGateway().transaction.search(filter)
  const rows = []
  let count = 0

  stream.on('data', (t) => {
    ++count
    const row = {
      status: t.status,
      name: `${t.customer.firstName} ${t.customer.lastName}`,
      email: t.customer.email,
      amount: t.amount,
      currency: t.currencyIsoCode,
      createdAt: t.createdAt,
      planId: t.planId,
      subscriptionId: t.subscriptionId,
      billingPeriodStartDate: t.subscription.billingPeriodStartDate,
      billingPeriodEndDate: t.subscription.billingPeriodEndDate,
      paymentInstrumentType: t.paymentInstrumentType,
      paypalEmail: t.paypal && t.paypal.payerEmail || null
    }
    rows.push(row)

    if (count % 10 === 0) {
      console.log(`Read ${rows.length} transactions.`)
    }
  })

  stream.on('end', function () {
    console.log(`It’s a Done Deal. Read ${rows.length} rows total.`)
    // Dump to CSV.
    Util.writeCsv(rows, '/tmp/braintree-transaction-data.csv')
  })

  stream.resume()
}

function getSubscriptions () {
  console.log('Fetching subscriptions ..')

  const filter = (f) => {
    f.status().in([
      Braintree.Subscription.Status.Active,
      Braintree.Subscription.Status.Canceled
    ])
  }

  const stream = getGateway().subscription.search(filter)
  const rows = []
  let count = 0

  stream.on('data', (s) => {
    ++count
    const row = {
      id: s.id,
      planId: s.planId,
      price: s.price,
      status: s.status,
      billingPeriodEndDate: s.billingPeriodEndDate,
      billingPeriodStartDate: s.billingPeriodStartDate,
      currentBillingCycle: s.currentBillingCycle,
      daysPastDue: s.daysPastDue,
      failureCount: s.failureCount,
      firstBillingDate: s.firstBillingDate,
      nextBillingDate: s.nextBillingDate,
      numberOfBillingCycles: s.numberOfBillingCycles
    }
    rows.push(row)

    if (count % 10 === 0) {
      console.log(`Read ${rows.length} subscriptions.`)
    }
  })

  stream.on('end', () => {
    console.log(`It’s a Done Deal. Read ${rows.length} rows total.`)

    // Sort it.
    rows.sort((a, b) => {
      return a.firstBillingDate > b.firstBillingDate ? -1 : 1
    })

    // Dump to CSV.
    Util.writeCsv(rows, '/tmp/braintree-subscription-data.csv')
  })

  stream.resume()
}
