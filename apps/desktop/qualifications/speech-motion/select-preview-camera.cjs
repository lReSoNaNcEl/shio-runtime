async function selectPreviewCamera(page, name) {
  await page.getByRole('button', { name: 'Camera angle', exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}

module.exports = { selectPreviewCamera }
