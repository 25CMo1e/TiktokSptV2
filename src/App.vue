<template>
  <div class="app">
    <MultiCastList />
  </div>
</template>

<script setup lang="ts">
import MultiCastList from './components/MultiCastList.vue';
import { printInfo, printSKMCJ } from './utils/logUtil';

setTimeout(() => {
  console?.clear();
  printSKMCJ();
  printInfo();
}, 1500);
</script>

<style lang="scss">
::selection {
  background-color: #8b968d;
  color: #fff;
}

.app {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
</style>
