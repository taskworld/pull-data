#!/bin/bash

node google.js \
 --id ga:93825837 \
 --from $1 \
 --dimensions ga:date,ga:eventAction,ga:eventLabel,ga:country \
 --metrics ga:totalEvents \
 --sortby ga:date,ga:eventAction \
 --order DESC,ASC \
 --name ga-events
