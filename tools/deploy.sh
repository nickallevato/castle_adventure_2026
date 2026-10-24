#!/bin/sh
# Publish the site to https://castles.bmux.sh (S3 + CloudFront). Needs AWS credentials in the environment.
set -e
cd "$(dirname "$0")/.."
BUCKET=castles.bmux.sh-web-675911353984
DIST=E2GTQK84GKD4P6
aws s3 cp index.html "s3://$BUCKET/index.html" --cache-control "max-age=300" --only-show-errors
for d in src data assets; do aws s3 sync "$d" "s3://$BUCKET/$d" --delete --cache-control "max-age=300" --only-show-errors; done
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" --query Invalidation.Id --output text
echo "Deployed to https://castles.bmux.sh"
