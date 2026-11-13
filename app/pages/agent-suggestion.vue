<script setup lang="ts">
definePageMeta({ path: '/requirements/:requirementId/suggestions/:suggestionId?', middleware: to => navigateTo('/requirements/' + encodeURIComponent(String(to.params.requirementId)), { replace: true, redirectCode: 302 }) })
</script>
<template><div /></template>
