to startup {
  print 'Starting GP...'
  setGlobal 'vectorTrails' false
  gc
  print (mem)
  fetchProject
  openProjectEditor false false
  fixLayout
  hide (stage (findProjectEditor))

// test
// while true { waitMSecs 10 }

// reload './uitestSound.gp'
// closeAudio
// while true { waitMSecs 10 }

// bm = (newBitmap 100 100)
// setFont 'Arial' 18
// drawString bm 'A'
// while true { waitMSecs 10 }
//
// reload './graphicsTests.gp'
// openWindow 600 600
// testReadTexture

// reload './paint.gp'
// run (new 'Paint')
}

to test {
  bm1 = (newBitmap 100 100 (color 200 0 0))
  blend = 0 // replace
  fillRect bm1 (color 0 0 200 100) 10 25 20 50 blend
  blend = 1 // blend
  fillRect bm1 (color 0 0 200 100) 40 25 20 50 blend
  fillRect bm1 (color 0 0 200 100) 70 25 20 50 // default
  drawBitmap nil bm1 5 0
  fillRect nil (gray 0) 0 110 500 110
  drawBitmap nil bm1 5 115

  bm2 = (newBitmap 100 100 (gray 255))
  drawBitmap bm2 bm1 0 0 255 0 // replace
  drawBitmap nil bm2 115 0
  drawBitmap nil bm2 115 115

  bm2 = (newBitmap 100 100 (gray 255))
  drawBitmap bm2 bm1 0 0 255 1 // blend
  drawBitmap nil bm2 225 0
  drawBitmap nil bm2 225 115
}

to test2 {
  tx1 = (newTexture 100 100 (color 0 200 0))
  fillRect tx1 (color 0 0 200 100) 10 25 20 50 0 // replace
  fillRect tx1 (color 0 0 200 100) 40 25 20 50 1 // blend
  fillRect tx1 (color 0 0 200 100) 70 25 20 50 // default (replace)
  showTexture nil tx1 5 0
  fillRect nil (gray 0) 0 110 500 110
  showTexture nil tx1 5 115

  tx2 = (newTexture 100 100 (color 250))
  showTexture tx2 tx1 0 0 255 1 1 0 nil 0 // replace
  showTexture nil tx2 115 0
  showTexture nil tx2 115 115

  tx2 = (newTexture 100 100 (color 250))
  showTexture tx2 tx1 0 0 255 1 1 0 nil 1 // blend
  showTexture nil tx2 225 0
  showTexture nil tx2 225 115
}

to test3 {
  replace = 0
  blend = 1
  bm1 = (newBitmap 100 100 (color 200 0 0))
  fillRect bm1 (color 0 0 200 100) 10 25 20 50 replace
  fillRect bm1 (color 0 0 200 100) 40 25 20 50 blend
  fillRect bm1 (color 0 0 200 100) 70 25 20 50 // default
  drawBitmap nil bm1 5 0
  fillRect nil (gray 0) 0 110 500 110
  drawBitmap nil bm1 5 115

  bm2 = (newBitmap 100 100 (gray 255))
  drawBitmap bm2 bm1 0 0 255 replace
  drawBitmap nil bm2 115 0
  drawBitmap nil bm2 115 115

  bm2 = (newBitmap 100 100 (gray 255))
  drawBitmap bm2 bm1 0 0 255 blend
  drawBitmap nil bm2 225 0
  drawBitmap nil bm2 225 115

  bm1 = (newBitmap 100 100 (color 200 0 0 100))
  bm2 = (newBitmap 100 100 (gray 255))
  t = (newTimer)
  repeat 1000 {   drawBitmap bm2 bm1 0 0 255 replace }
  t0 = (msecSplit t)
  repeat 1000 {   drawBitmap bm2 bm1 0 0 255 blend }
  t1 = (msecSplit t)
  print 'replace' t0 'blend' t1
}

// Arguments: dstTexture srcTexture [x y alpha xScale yScale rotationDegrees flip blendMode clipRect]"},
