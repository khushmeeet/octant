<script lang="ts">
	import { page } from '$app/state';
	import { parsePulls } from '$lib/nav/paths';
	import { recent } from '$lib/nav/recent.svelte';
	import ReviewScreen from '$lib/review/ReviewScreen.svelte';

	/**
	 * Pull requests, narrowed by state.
	 *
	 * Which states are shown is a query parameter rather than a segment, the
	 * line `nav/paths.ts` draws everywhere: a scope is a segment because it
	 * names a different object, and a view is a parameter because it narrows
	 * what is shown of one.
	 */
	const address = $derived(parsePulls(page.params, page.url.searchParams));

	$effect(() => {
		void recent.remember({ ...address.repo });
	});
</script>

<ReviewScreen {address} />
