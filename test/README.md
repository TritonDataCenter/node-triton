The node-triton test suite.

There are two sets of tests here: *unit* tests which can be run in your local
clone (see "test/unit/") and *integration* tests which are run against a
cloudapi. 

**WARNING**: While this test suite should strive to not be destructive to
existing data in the used account, one should take pause before blindly
running it with one's cloudapi creds.


# Usage

Unit tests should be run before commits:

    make test

Or you can run a specific test file via:

    cd test
    ./runtest unit/foo.test.js


Integration tests: XXX how to run?


# Development Guidelines

- We are using [tape](https://github.com/substack/tape).

- Use "test/lib/\*.js" and "test/{unit,integration}/helpers.js" to help make
  ".test.js" code more expressive:

- Unit tests (i.e. not requiring the cloudapi endpoint) in "unit/\*.test.js".
  Integration tests "integration/\*.test.js".

