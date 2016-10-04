#!/bin/bash

node google.js \
 --id ga:93825837 \
 --from $1 \
 --dimensions ga:date,ga:adGroup,ga:eventLabel,ga:adMatchedQuery,ga:sourceMedium,ga:country \
 --metrics ga:totalEvents \
 --sortby ga:date \
 --order DESC \
 --filter 'ga:eventAction,IN_LIST,Completed-SignUp,Press Signup' \
 --name adword-signups
