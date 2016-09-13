'use strict'

const P = require('bluebird')
const Moment = require('moment')
const Assert = require('assert')
const PayPal = require('paypal-rest-sdk')
const Util = require('./util')
const Fs = require('fs')

Assert(process.env.PULLDATA_PAYPAL_CLIENT_ID, 'Missing env `PULLDATA_PAYPAL_CLIENT_ID`')
Assert(process.env.PULLDATA_PAYPAL_SECRET, 'Missing env `PULLDATA_PAYPAL_SECRET`')

PayPal.configure({
  'mode': 'live', // sandbox or live
  'client_id': process.env.PULLDATA_PAYPAL_CLIENT_ID,
  'client_secret': process.env.PULLDATA_PAYPAL_SECRET
})

const Argv = require('minimist')(process.argv.slice(2))

if (Argv.payments) {
  getPayments('2016-08-15')
} else {
  console.log(`
  Usage: node paypal.js
    --payments       Fetch all payments from PayPal
      [--from]       Date from which to fetch transactions, e.g. 2016-08-01
  `)
}

function getPayments (from) {
  const fromDate = Moment(from, 'YYYY-MM-DD').startOf('month')
  const toDate = fromDate.clone().endOf('month')
  console.log(`
  Fetching transactions:
  Range, from ${fromDate.format('YYYY-MM-DD')} - ${toDate.format('YYYY-MM-DD')}
  `)

  const opts = {
    count: 20,
    start_time: fromDate.format('YYYY-MM-DD[T]HH:mm:ss[Z]'),
    end_time: toDate.format('YYYY-MM-DD[T]HH:mm:ss[Z]'),
    max: 1000,
    results: []
  }

  return getPaymentsList(opts)
  .then(() => {
    console.log('All Results:', opts.results.length)
    // console.log(JSON.stringify(opts.results, null, 2))
    Fs.writeFileSync('/tmp/paypal.json', JSON.stringify(opts.results, null, 2))
  })
}

function getPaymentsList (opts) {
  return new P(resolve => {
    console.log('Get Payments List:', opts)
    PayPal.payment.list(opts, (error, payments) => {
      if (error) {
        console.log('Error:', error)
        console.log('Details:', payments)
        throw error
      }
      resolve(payments)
    })
  })
  .then(payments => {
    opts.results = opts.results.concat(payments.payments)
    console.log('List Payments Response:', payments.count)
    // console.log(JSON.stringify(payments, null, 2))

    if (payments.next_id && opts.results.length < opts.max) {
      opts.start_id = payments.next_id
      return getPaymentsList(opts)
    }
  })
}
