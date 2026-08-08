<script lang="ts">
	import { page } from '$app/state';
	import LogScreen from '$lib/log/LogScreen.svelte';
	import { parseLog } from '$lib/nav/paths';
	import { recent } from '$lib/nav/recent.svelte';

	/**
	 * History at a revision, optionally scoped to a path.
	 *
	 * The scope is a segment and the author is a query parameter, which is the
	 * difference between addressing another object and narrowing the view of
	 * this one — see `nav/paths.ts`.
	 */
	const address = $derived(parseLog(page.params, page.url.searchParams));

	$effect(() => {
		void recent.remember({ ...address.repo });
	});
</script>

<LogScreen {address} />
