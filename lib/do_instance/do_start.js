/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/*
 * Copyright 2016 Joyent, Inc.
 *
 * `triton instance start ...`
 */

var gen_do_ACTION = require('./gen_do_ACTION');


var do_start = gen_do_ACTION({action: 'start'});
module.exports = do_start;
