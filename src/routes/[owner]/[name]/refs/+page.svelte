<script lang="ts">
	import { page } from '$app/state';
	import { parseRefs } from '$lib/nav/paths';
	import { recent } from '$lib/nav/recent.svelte';
	import RefsScreen from '$lib/refs/RefsScreen.svelte';

	/**
	 * Branches and tags, on one screen — they are the same object.
	 *
	 * Both of this screen's parameters are query parameters rather than
	 * segments: which kind is shown is a view of one address, and which ref is
	 * open is a selection within it. Neither names a different object, which is
	 * the line `nav/paths.ts` draws everywhere.
	 */
	const address = $derived(parseRefs(page.params, page.url.searchParams));

	$effect(() => {
		void recent.remember({ ...address.repo });
	});
</script>

<RefsScreen {address} />
