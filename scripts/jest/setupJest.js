global.__DEV__ = true;

expect.extend({
	...require('./reactTestMatchers')
});
