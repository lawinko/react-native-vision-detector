import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useFrameProcessor,
} from 'react-native-vision-camera';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { useRunOnJS } from 'react-native-worklets-core';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import Slider from '@react-native-community/slider';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

export default function App() {
  const { hasPermission, requestPermission } = useCameraPermission()
  const [cameraType, setCameraType] = useState('back')
  const device = useCameraDevice(cameraType)
  const [detections, setDetections] = useState([])
  const [fps, setFps] = useState(0)
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.5)

  const model = useTensorflowModel(require('./models/ssd_mobilenet_v1.tflite'))
  const actualModel = model.state === 'loaded' ? model.model : undefined

  const labels = require('./models/labels.json')

  const { resize } = useResizePlugin()

  const processDetection = (outputs, sWidth, sHeight, threshold) => {
    'worklet'

    if (!outputs || outputs.length < 4) return []

    const boxes = outputs[0]        // Object with string keys (40 elements: 10 detections × 4 coordinates each)
    const classes = outputs[1]      // Object with string keys (class indices)
    const scores = outputs[2]       // Object with string keys (confidence scores)
    const numDetections = outputs[3][0] // Single value: number of valid detections

    const detectedObjects = []
    const count = Math.min(numDetections, 10)

    for (let i = 0; i < count; i++) {
      // All outputs are objects with string keys
      const score = scores[i.toString()]

      if (score < threshold) continue

      const classIndex = Math.floor(classes[i.toString()])
      const label = labels[classIndex.toString()] || `Class ${classIndex}`

      // Get bounding box coordinates (normalized 0-1)
      const ymin = boxes[(i * 4 + 0).toString()]
      const xmin = boxes[(i * 4 + 1).toString()]
      const ymax = boxes[(i * 4 + 2).toString()]
      const xmax = boxes[(i * 4 + 3).toString()]

      const object = {
        id: `${i}-${performance.now()}`,
        label,
        confidence: score,
        box: {
          x: Math.max(0, xmin * sWidth),
          y: Math.max(0, ymin * sHeight),
          width: Math.min(sWidth, (xmax - xmin) * sWidth),
          height: Math.min(sHeight, (ymax - ymin) * sHeight),
        },
      }

      detectedObjects.push(object)
    }
    return detectedObjects
  }

  const updateDetectionsOnJS = useRunOnJS((detections) => {
    if (detections) {
      setDetections(detections)
    } else {
      setDetections([])
    }
  }, [setDetections])

  const updateFpsOnJS = useRunOnJS((currentFps) => {
    setFps(currentFps)
  }, [setFps])

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet'
      if (actualModel == null) {
        return
      }

      // Calculate FPS using shared value for persistence
      const currentTime = performance.now()
      const storedLastTime = global.lastFrameTime || 0

      if (storedLastTime > 0) {
        const timeDiff = currentTime - storedLastTime
        const currentFps = Math.round(1000 / timeDiff)
        updateFpsOnJS(currentFps)
      }
      global.lastFrameTime = currentTime

      const resized = resize(frame, {
        scale: {
          width: 300,
          height: 300,
        },
        pixelFormat: 'rgb',
        dataType: 'uint8',
      })
      const result = actualModel.runSync([resized])
      const processedDetections = processDetection(result, screenWidth, screenHeight, confidenceThreshold)
      updateDetectionsOnJS(processedDetections)
    },
    [actualModel, confidenceThreshold, screenWidth, screenHeight]
  )

  React.useEffect(() => {
    requestPermission()
  }, [requestPermission])

  const toggleCamera = () => {
    setCameraType(current => current === 'back' ? 'front' : 'back')
  }

  return (
    <View style={styles.container}>
      {hasPermission && device != null ? (
        <Camera
          device={device}
          style={StyleSheet.absoluteFill}
          isActive={true}
          frameProcessor={frameProcessor}
          pixelFormat="yuv"
          frameProcessorFps={3}
        />
      ) : (
        <View style={styles.noCameraContainer}>
          <Text style={styles.noCameraText}>No Camera available.</Text>
        </View>
      )}

      {/* Overlay for bounding boxes */}
      <View style={styles.overlay}>
        {detections.map((detection) => (
          <View
            key={detection.id}
            style={[
              styles.boundingBox,
              {
                left: detection.box.x,
                top: detection.box.y,
                width: detection.box.width,
                height: detection.box.height,
              }
            ]}
          >
            <View style={styles.labelContainer}>
              <Text style={styles.label}>
                {detection.label} ({Math.round(detection.confidence * 100)}%)
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* Settings Panel */}
      <View style={styles.settingsPanel}>
        <Text style={styles.settingsTitle}>Confidence: {Math.round(confidenceThreshold * 100)}%</Text>
        <Slider
          style={styles.slider}
          minimumValue={0.1}
          maximumValue={0.9}
          value={confidenceThreshold}
          onValueChange={setConfidenceThreshold}
          minimumTrackTintColor="#00ff00"
          maximumTrackTintColor="#666"
          thumbStyle={styles.sliderThumb}
        />
      </View>

      {/* Camera Controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.button} onPress={toggleCamera}>
          <Text style={styles.buttonText}>
            {cameraType === 'back' ? '📷 Front' : '📷 Back'}
          </Text>
        </TouchableOpacity>

        <View style={styles.stats}>
          <Text style={styles.statsText}>
            Detections: {detections.length}
          </Text>
          <Text style={styles.statsText}>
            FPS: {fps}
          </Text>
        </View>
      </View>

      {model.state === 'loading' && (
        <ActivityIndicator size="small" color="white" />
      )}

      {model.state === 'error' && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Failed to load model! {model.error.message}</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  boundingBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#00ff00',
    backgroundColor: 'transparent',
  },
  labelContainer: {
    position: 'absolute',
    top: -30,
    left: 0,
    backgroundColor: '#00ff00',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 3,
  },
  label: {
    color: '#000',
    fontSize: 12,
    fontWeight: 'bold',
  },
  controls: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 2,
  },
  button: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  buttonText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 14,
  },
  stats: {
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 10,
    minWidth: 120,
  },
  statsText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  settingsPanel: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: 15,
    borderRadius: 10,
    zIndex: 2,
  },
  settingsTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  sliderThumb: {
    backgroundColor: '#00ff00',
    width: 20,
    height: 20,
  },
  noCameraContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  noCameraText: {
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
  },
  errorContainer: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255, 0, 0, 0.8)',
    padding: 15,
    borderRadius: 10,
    zIndex: 3,
  },
  errorText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
  },
});
