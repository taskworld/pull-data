#!/bin/bash

node google.js \
 --id ga:93825837 \
 --from $1 \
 --dimensions ga:date,ga:adwordsCampaignID,ga:adGroup \
 --metrics ga:sessions,ga:adCost,ga:adClicks,ga:goal7Completions \
 --sortby ga:date \
 --order DESC \
 --name adword-stats
