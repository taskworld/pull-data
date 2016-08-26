#!/bin/bash

node google.js \
 --id ga:93825837 \
 --from $1 \
 --dimensions ga:date,ga:adwordsCampaignID,ga:adGroup \
 --metrics ga:adCost,ga:adClicks,ga:goal7Completions \
 --sortby ga:date \
 --order DESC \
 --name adwords-data-$1
