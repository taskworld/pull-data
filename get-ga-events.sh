#!/bin/bash

node google.js \
 --id ga:104623764 \
 --from $1 \
 --dimensions ga:date,ga:eventAction,ga:eventLabel,ga:country \
 --metrics ga:totalEvents \
 --sortby ga:date,ga:eventAction \
 --order DESC,ASC \
 --filter ga:eventLabel,BEGINS_WITH,UID:5567cf05870e405f53cdc5a8: \
 --name ga-events
