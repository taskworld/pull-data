#!/bin/bash

node google.js \
 --id ga:93825837 \
 --from $1 \
 --dimensions ga:year,ga:month,ga:sourceMedium \
 --metrics ga:users,ga:adClicks,ga:goal7Completions,ga:goal9Completions,ga:adCost \
 --sortby ga:year,ga:month,ga:goal7Completions,ga:goal9Completions,ga:users \
 --order DESC,DESC,DESC,DESC,DESC \
 --name adword-stats

node google.js \
--id ga:93825837 \
--from $1 \
--dimensions ga:adwordsCampaignID,ga:adGroup \
--metrics ga:users,ga:adClicks,ga:goal7Completions,ga:goal9Completions,ga:adCost \
--sortby ga:goal7Completions,ga:goal9Completions,ga:adGroup \
--order DESC,DESC,ASC \
--name adgroup-alltime-stats
