#!/bin/sh

# Build the zip file
mkdir -p build
rm -r build/*
cp -r package.json yarn.lock .yarnclean index.js build
(
    cd build;
    yarn --production;
    rm package.json;
)
zip -qrmX build.zip build
