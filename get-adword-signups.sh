#!/bin/bash

node google.js \
 --id ga:93825837 \
 --from $1 \
 --dimensions ga:date,ga:adwordsCampaignID,ga:adGroup,ga:eventAction,ga:eventLabel \
 --metrics ga:totalEvents \
 --sortby ga:date \
 --order DESC \
 --filter ga:eventAction,EXACT,Completed-SignUp \
 --name adword-signups
