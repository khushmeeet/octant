<script lang="ts">
	import { page } from '$app/state';
	import CompareScreen from '$lib/compare/CompareScreen.svelte';
	import { parseCompare } from '$lib/nav/paths';
	import { recent } from '$lib/nav/recent.svelte';

	/**
	 * What is between two revisions. Addressed with commit SHAs by everything
	 * that links here, which is what makes the answer permanent — though the
	 * route accepts any two revisions GitHub can resolve, because
	 * `/compare/main/v1.2.0` is a URL a person would reasonably type.
	 */
	const address = $derived(parseCompare(page.params));

	$effect(() => {
		void recent.remember({ ...address.repo });
	});
</script>

<CompareScreen {address} />
