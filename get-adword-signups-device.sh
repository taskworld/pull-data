#!/bin/bash

node google.js \
 --id ga:93825837 \
 --from $1 \
 --dimensions ga:date,ga:eventLabel,ga:deviceCategory \
 --metrics ga:totalEvents \
 --sortby ga:date \
 --order DESC \
 --filter 'ga:eventAction,IN_LIST,Completed-SignUp,Press Signup,Completed-SignUp-Google' \
 --name adword-signups-device
