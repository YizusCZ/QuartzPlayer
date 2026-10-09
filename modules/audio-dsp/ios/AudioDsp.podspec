Pod::Spec.new do |s|
  s.name           = 'AudioDsp'
  s.version        = '1.0.0'
  s.summary        = 'Equaliser for Quartz'
  s.description    = 'Graphic equaliser bridge (Android DynamicsProcessing; iOS pending).'
  s.author         = ''
  s.homepage       = 'https://github.com/'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
