'use strict'

const Moment = require('moment')
const Assert = require('assert')
const Braintree = require('braintree')

Assert(process.env.PULLDATA_BRAINTREE_MERCHANT_ID, 'Missing env `PULLDATA_BRAINTREE_MERCHANT_ID`')
Assert(process.env.PULLDATA_BRAINTREE_KEY, 'Missing env `PULLDATA_BRAINTREE_KEY`')
Assert(process.env.PULLDATA_BRAINTREE_PRIVATE_KEY, 'Missing env `PULLDATA_BRAINTREE_PRIVATE_KEY`')

getActiveSubscriptions()

function getGateway () {
  return Braintree.connect({
    environment: Braintree.Environment.Production,
    merchantId: process.env.PULLDATA_BRAINTREE_MERCHANT_ID,
    publicKey: process.env.PULLDATA_BRAINTREE_KEY,
    privateKey: process.env.PULLDATA_BRAINTREE_PRIVATE_KEY
  })
}

function getActiveSubscriptions () {
  const minDate = Moment('2016-08-01')
  getGateway().subscription
  .search((search) => {
    // search.status().is(Braintree.Subscription.Status.Active)
  }, (err, response) => {
    if (err) {
      return console.error(err)
    }
    response.each(function (err, subscription) {
      if (err) {
        return console.error(err)
      }
      if (Moment(subscription.firstBillingDate).isBefore(minDate)) {
        return null
      }
      console.log('subscription=', subscription.firstBillingDate, subscription.status)
    })
  })
}
