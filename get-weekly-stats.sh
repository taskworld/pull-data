#!/bin/bash

node google.js \
 --id ga:93825837 \
 --from $1 \
 --dimensions ga:year,ga:week,ga:adGroup,ga:sourceMedium \
 --metrics ga:users,ga:adClicks,ga:goal7Completions,ga:adCost \
 --sortby ga:year,ga:week,ga:goal7Completions,ga:adClicks,ga:users \
 --order DESC,DESC,DESC,DESC,DESC \
 --name weekly-stats
