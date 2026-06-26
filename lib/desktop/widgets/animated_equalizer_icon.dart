import 'dart:async';

import 'package:flutter/material.dart';

/// Animated equalizer icon with bouncing bars
class AnimatedEqualizerIcon extends StatefulWidget {
  final Color color;
  final double size;

  const AnimatedEqualizerIcon({super.key, required this.color, this.size = 16});

  @override
  State<AnimatedEqualizerIcon> createState() => _AnimatedEqualizerIconState();
}

class _AnimatedEqualizerIconState extends State<AnimatedEqualizerIcon>
    with TickerProviderStateMixin {
  late List<AnimationController> _controllers;
  late List<Animation<double>> _animations;
  late List<Timer> _startTimers;

  @override
  void initState() {
    super.initState();

    // Create 3 bars with different animation speeds
    _controllers = List.generate(
      3,
      (i) => AnimationController(
        vsync: this,
        duration: Duration(milliseconds: 300 + (i * 100)),
      ),
    );

    _animations = _controllers.map((controller) {
      return Tween<double>(
        begin: 0.3,
        end: 1.0,
      ).animate(CurvedAnimation(parent: controller, curve: Curves.easeInOut));
    }).toList();

    // Start animations with different phases
    _startTimers = List.generate(3, (i) {
      return Timer(Duration(milliseconds: i * 100), () {
        if (mounted) {
          _controllers[i].repeat(reverse: true);
        }
      });
    });
  }

  @override
  void dispose() {
    for (final timer in _startTimers) {
      timer.cancel();
    }
    for (var controller in _controllers) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.size,
      height: widget.size,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: List.generate(3, (i) {
          return Padding(
            padding: EdgeInsets.symmetric(horizontal: widget.size * 0.08),
            child: AnimatedBuilder(
              animation: _animations[i],
              builder: (context, child) {
                return Container(
                  width: widget.size * 0.15,
                  height: widget.size * _animations[i].value,
                  decoration: BoxDecoration(
                    color: widget.color,
                    borderRadius: BorderRadius.circular(widget.size * 0.05),
                  ),
                );
              },
            ),
          );
        }),
      ),
    );
  }
}
