/**
 * Pixel mascot canvas renderer with particle effects and interactive animations.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { playRetroSound } from '../audio/retro-synth.ts'
import { getMascotFrame, PALETTES, type MascotState } from './pixel-models.ts'
import type { MascotSkin } from './tamagotchi-store.ts'
import { tamagotchiStore } from './tamagotchi-store.ts'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  color: string
  char: string
  size: number
  alpha: number
  life: number
  maxLife: number
}

export interface PixelMascotCanvasProps {
  skin: MascotSkin
  state: MascotState
  scale?: number
  interactive?: boolean
  className?: string
  onPet?: () => void
}

export function PixelMascotCanvas({
  skin,
  state,
  scale = 4,
  interactive = true,
  className,
  onPet,
}: PixelMascotCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const [bounce, setBounce] = useState(0)
  const [blink, setBlink] = useState(false)
  const animRunningRef = useRef(false)
  const animFrameRef = useRef<number | null>(null)

  // Draw sprite on canvas
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return

    ctx.imageSmoothingEnabled = false

    let activeState = state
    if (blink && (state === 'idle' || state === 'thinking')) {
      activeState = 'error' // closed eyes appearance for blinking
    }

    const frame = getMascotFrame(skin, activeState)
    const palette = PALETTES[skin]
    const spriteHeight = frame.length
    const spriteWidth = frame[0]?.length ?? 16

    const canvasWidth = spriteWidth * scale + 24
    const canvasHeight = spriteHeight * scale + 24

    if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
      canvas.width = canvasWidth
      canvas.height = canvasHeight
    }

    ctx.clearRect(0, 0, canvasWidth, canvasHeight)

    const startX = 12
    const startY = 12 + (bounce * scale * 0.5)

    // Draw shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'
    ctx.beginPath()
    ctx.ellipse(
      startX + (spriteWidth * scale) / 2,
      startY + spriteHeight * scale - 2,
      (spriteWidth * scale) / 2.5,
      4,
      0,
      0,
      Math.PI * 2,
    )
    ctx.fill()

    // Draw pixels
    for (let y = 0; y < spriteHeight; y++) {
      const row = frame[y]
      if (row === undefined) continue
      for (let x = 0; x < row.length; x++) {
        const char = row[x]
        if (char === '.' || char === undefined) continue

        let color = palette.primary
        switch (char) {
          case 'B': color = palette.primary; break
          case 'D': color = palette.dark; break
          case 'L': color = palette.light; break
          case 'E': color = palette.eye; break
          case 'P': color = palette.pupil; break
          case 'A': color = palette.accent; break
          case 'C': color = palette.tool; break
          case 'H': color = palette.heart; break
          case 'W': color = palette.white; break
          case '^': color = palette.pupil; break
        }

        ctx.fillStyle = color
        ctx.fillRect(startX + x * scale, startY + y * scale, scale, scale)
      }
    }

    // Draw & update particles
    for (let i = particlesRef.current.length - 1; i >= 0; i--) {
      const p = particlesRef.current[i]
      if (p === undefined) continue
      p.life += 1
      p.x += p.vx
      p.y += p.vy
      p.alpha = Math.max(0, 1 - p.life / p.maxLife)

      ctx.save()
      ctx.globalAlpha = p.alpha
      ctx.font = `${p.size}px monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = p.color
      ctx.fillText(p.char, p.x, p.y)
      ctx.restore()

      if (p.life >= p.maxLife) {
        particlesRef.current.splice(i, 1)
      }
    }
  }, [skin, state, scale, bounce, blink])

  // Run animation loop when particles exist
  const loop = useCallback(() => {
    draw()
    if (particlesRef.current.length > 0) {
      animFrameRef.current = requestAnimationFrame(loop)
    } else {
      animRunningRef.current = false
    }
  }, [draw])

  const startParticleLoop = useCallback(() => {
    if (!animRunningRef.current) {
      animRunningRef.current = true
      animFrameRef.current = requestAnimationFrame(loop)
    }
  }, [loop])

  // Trigger floating particles (hearts, coffee, sparkles)
  const spawnParticles = useCallback((type: 'heart' | 'coffee' | 'sparkle' | 'confetti' | 'star') => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const count = type === 'confetti' ? 14 : type === 'heart' ? 5 : 3
    const width = canvas.width || 80
    const height = canvas.height || 80

    for (let i = 0; i < count; i++) {
      let char = '❤️'
      let color = '#ff4d88'
      if (type === 'coffee') {
        char = '☕'
        color = '#d4a373'
      } else if (type === 'sparkle') {
        char = '✦'
        color = '#00ffff'
      } else if (type === 'confetti') {
        char = '▪'
        const colors = ['#ff006e', '#3a86ff', '#ffbe0b', '#06d6a0', '#8338ec']
        color = colors[Math.floor(Math.random() * colors.length)] ?? '#ffbe0b'
      } else if (type === 'star') {
        char = '★'
        color = '#ffd700'
      }

      particlesRef.current.push({
        x: width / 2 + (Math.random() - 0.5) * (width * 0.5),
        y: height / 2 + (Math.random() - 0.5) * (height * 0.3),
        vx: (Math.random() - 0.5) * 1.8,
        vy: -1.2 - Math.random() * 2.0,
        color,
        char,
        size: Math.floor(10 * (scale / 4)),
        alpha: 1,
        life: 0,
        maxLife: 40 + Math.floor(Math.random() * 30),
      })
    }
    startParticleLoop()
  }, [scale, startParticleLoop])

  // Periodic blinking and breathing bounce
  useEffect(() => {
    let blinkTimer: ReturnType<typeof setTimeout>
    const scheduleBlink = () => {
      blinkTimer = setTimeout(() => {
        setBlink(true)
        setTimeout(() => {
          setBlink(false)
          scheduleBlink()
        }, 160)
      }, 2500 + Math.random() * 3000)
    }
    scheduleBlink()

    const bounceInterval = setInterval(() => {
      setBounce(b => (b === 0 ? 1 : 0))
    }, state === 'streaming' ? 120 : state === 'thinking' ? 250 : 600)

    return () => {
      clearTimeout(blinkTimer)
      clearInterval(bounceInterval)
    }
  }, [state])

  // Redraw whenever state, skin, scale, bounce, or blink updates
  useEffect(() => {
    draw()
  }, [draw])

  // Cleanup animation frames on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current)
      }
    }
  }, [])

  // Spawn ambient particles based on agent state
  useEffect(() => {
    if (state === 'streaming') {
      const interval = setInterval(() => {
        spawnParticles('sparkle')
      }, 400)
      return () => { clearInterval(interval) }
    }
    if (state === 'success') {
      spawnParticles('confetti')
    }
    if (state === 'error') {
      spawnParticles('star')
    }
  }, [state, spawnParticles])

  const handleClick = useCallback(() => {
    if (!interactive) return
    spawnParticles('heart')
    const stateSnapshot = tamagotchiStore.getSnapshot()
    playRetroSound('pet', stateSnapshot.soundEnabled)
    tamagotchiStore.pet()
    onPet?.()
  }, [interactive, spawnParticles, onPet])

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        imageRendering: 'pixelated',
        cursor: interactive ? 'pointer' : 'default',
        touchAction: 'none',
      }}
      onClick={handleClick}
      title={interactive ? 'Click to pet your companion!' : undefined}
    />
  )
}
