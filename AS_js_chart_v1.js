// set up namespace
var AS_JS_Chart_v1 = {};

// Settings Class - Stores and Manages Chart Settings
AS_JS_Chart_v1.Settings = function(settings) {
	this.settings = settings;
}

AS_JS_Chart_v1.Settings.prototype.get_settings = function(parameter_keys) {
	if (parameter_keys && this.settings) {	
		var settings = {};
		for (var i = 0; i < parameter_keys.length; i++) {
			settings[parameter_keys[i]] = this.settings[parameter_keys[i]];
		}
		return settings;
	} else {
		return this.settings;
	}
}

AS_JS_Chart_v1.Settings.prototype.set_settings = function(parameters) { 
	for (var key in parameters) 
		this.settings[key] = parameters[key];
}

// Chart Class - Main Framework for displaying pure JavaScript charts
// Implementation uses Canvas object and conceptual "infinite" horizontal scroll for displaying continuous data like time series along X axis
// Y axis range is fixed to user-selected scale, default is data min/max, zoomable using +/- control. X axis range is also fixed to a window, with +/- zoom.
// Multiple data series can be displayed, using absolute positioning and hideable canvas elements with transparent background.
// Scroll bars are controllable from outside using API function, to enable automated scrolling.
// Data for series is supplied using the Data and Data.Series classes

AS_JS_Chart_v1.Chart = function(default_settings) {
	this.settings = new AS_JS_Chart_v1.Settings(default_settings);
	this.chart_container = null;
	this.ref_width = 0; // reference width to keep during resizing, to only redraw if major resizing occured
	this.chart_panel_size = {width:0, height:0}; // initializing for simpler code
	this.scroll_position = {x: 0, y: 0}; // keeping scroll bar positioned on data while resizing
	this.data = new AS_JS_Chart_v1.Data(this.settings);
	this.current_data_segment_index = -1;
	this.locked = false;
	this.data_panes = [];
}

AS_JS_Chart_v1.Chart.prototype.init = function(container_id, mode, settings, data) {
	if (this.chart_container == null) { // rudimentary disabling of repeat calls
		this.settings.set_settings(settings);
		if (container_id) 
			this.chart_container = document.getElementById(container_id);
		if (!this.chart_container || this.chart_container == null) {
			if (mode == "Current Page") {
				this.chart_container = document.body;
				var chart_wrapper = this.chart_container.querySelector("#chart_wrapper");
				if (chart_wrapper) // allow only one chart for now, and delete previous one
					this.chart_container.removeChild(chart_wrapper);
			} else {
				this.chart_container = this.get_new_window_container(this.settings.width, this.settings.height);
			}
		} else { // clear previous chart
			var fc = this.chart_container.firstChild;
			while ( fc ) {
    				this.chart_container.removeChild( fc );
    				fc = this.chart_container.firstChild;
			}
		}
		// Assuming all worked out OK with new window and we can use handle directly to show the chart
		this.data.get_data();
		this.set_layout();
		this.draw_data(this, 0);
		// rudimentary event delegation for this chart
		var chart = this;
		this.chart_container.addEventListener('click', function (event) {chart.delegate_event(event, chart);});
	}
}

// This is the actual scroll task - the rest is a Do-it-Yourself Chart library implementation
// Chart scrolling is triggered by event-delegated click on Run control, it watches hidden checkbox to stop/start scrolling
// Scrolling stops when it reaches the maximum scrollbar position, and updates Run control to stopped state
// Function checks scroll position first (in case user moved it), then increments unless end is reached and uses setTimeout to continue
AS_JS_Chart_v1.Chart.prototype.scroll_chart = function(chart, scrolled_element, caller_control, time_period) {
	var increment = 1; // smooth but slow if large dataset is being displayed
	var period = 10; // milliseconds between runs
	if (time_period && time_period > 0)
		period = time_period;
	if (scrolled_element && caller_control) {
		if (caller_control.checked) {
			var max_scroll_position = scrolled_element.scrollWidth - scrolled_element.clientWidth;
			if (scrolled_element.scrollLeft < max_scroll_position-1) {
				scrolled_element.scrollLeft = scrolled_element.scrollLeft + increment;
				setTimeout(function() {chart.scroll_chart(chart, scrolled_element, caller_control, period)}, period);
			} else {
				caller_control.checked = false;
				return false;
			}
		}
	}
	return true;
}

// Somewhat asynchronous Event delegation, relying on event handlers to throttle repeated events and monitor current control states
AS_JS_Chart_v1.Chart.prototype.delegate_event = function(event, chart) {
	event.preventDefault();
	var chart_pane_wrapper = chart.chart_container.querySelector("#chart_pane_wrapper");
	var target = event.target;
	var action = target.title;
	while (target && (!action || action.length == 0)) { // Rudimentory detection of actionable events
		target = target.parentNode;
		action = target.title;
	}
	if (event.type == 'click') {
		if (action == 'Play') {
			//alert('Running');
			var caller_control = target.querySelector('input');
			caller_control.checked = !caller_control.checked;
			if (!chart.scroll_chart(chart, chart_pane_wrapper, caller_control, 10)) {
				chart_pane_wrapper.scrollLeft = 0;
				caller_control.checked = true;
				chart.scroll_chart(chart, chart_pane_wrapper, caller_control, 10);
			}
		}
	}
}

// Special handling for scroll events - need to throttle them properly and distinguish between human and machine
AS_JS_Chart_v1.Chart.prototype.track_scroll = function(chart, scrolled_element) { // FIXME: currently only tracking x axis scroll (y axis is fixed)
	var new_position = scrolled_element.scrollLeft;	
	var max_scroll_position = scrolled_element.scrollWidth - scrolled_element.clientWidth;
	if (new_position < max_scroll_position - 10) {
		var new_data_segment_index = Math.floor(new_position/chart.chart_panel_size.width);
		if (!chart.locked && chart.current_data_segment_index != new_data_segment_index) {
			chart.locked = true;
			setTimeout(function() {chart.locked = false;}, 100);
			chart.draw_data(chart, new_data_segment_index);
			chart.current_data_segment_index = new_data_segment_index;
		}
	}
	chart.scroll_position.x = new_position;
}

AS_JS_Chart_v1.Chart.prototype.draw_data = function(chart, data_segment_index) {
	// FIXME: for now a single series is plotted, need to extend here to multiple
	if (chart.data.series.length > 0) {
		var delta = data_segment_index-chart.current_data_segment_index;
		if (chart.current_data_segment_index == -1 || Math.abs(delta) > 1)
			chart.draw_data_segment(chart, data_segment_index, 0);
		if (delta > 0 || Math.abs(delta) > 1)
			setTimeout(function() {chart.draw_data_segment(chart, data_segment_index+1, 0)}, 1);
		if (data_segment_index > 0 && (delta < 0 || Math.abs(delta) > 1))
			setTimeout(function() {chart.draw_data_segment(chart, data_segment_index-1, 0)}, 1);
	}
}			

AS_JS_Chart_v1.Chart.prototype.draw_data_segment = function(chart, data_segment_index, series_id) {
	var pane_index = data_segment_index % 3;
	var chart_pane = chart.data_panes[pane_index];
	//alert(pane_index);
	if (chart_pane) {
		if (chart_pane.classList.contains('Template'))
			chart_pane.classList.toggle('Template');
		var pixel_data = chart.data.get_data_segment(chart, data_segment_index, series_id);
		var data_range = chart.data.get_data_range(chart, data_segment_index, series_id);
		var series = chart.data.series[series_id];
		var graph_pane = chart_pane.querySelector("#graph_pane");
		var canvas = graph_pane.querySelector("#data_canvas");
		if (!canvas) {
			var canvas_settings = {};
			canvas_settings.width = graph_pane.offsetWidth;
			canvas_settings.height = graph_pane.offsetHeight;
			canvas = chart.add_child_element(graph_pane, 'canvas', 'data_canvas', 'Data Canvas', canvas_settings);
		}
		var context = canvas.getContext('2d');
		context.clearRect(0, 0, canvas.width, canvas.height);
		context.beginPath();
		for (var i=1; i<pixel_data.length; i++) {
          		context.moveTo(i-1, pixel_data[i-1]); 
          		context.lineTo(i, pixel_data[i]);
		}
		context.strokeStyle = 'red'; //"#CCCCCC";
		context.lineWidth = 1;
		context.stroke();
		context.closePath();
		var pane_offset = chart.chart_panel_size.width * data_segment_index;
		chart_pane.style.left = pane_offset + 'px';
		var tick_label_precision = 1; // FIXME: needs to be put into settings
		var tick_labels = chart_pane.querySelectorAll("#X_axis_tick_label");
		if (data_range && data_range > 0 && tick_labels && tick_labels.length > 0) {
			var tick_increment = data_range/(tick_labels.length+1); // FIXME: improve this crude method, including handling of axes ends
			for (var i=0; i<tick_labels.length; i++) {
				if (data_segment_index > 0 || i > 0) { // FIXME: origin label gets clipped, not showing for now
					var tick_value = data_range * (data_segment_index + i/tick_labels.length); 
					tick_labels[i].innerHTML = Number(tick_value.toFixed(tick_label_precision));
				}
			}
		}
	}
}

AS_JS_Chart_v1.Chart.prototype.set_layout = function() {
	var controls_location = 'Right'; // default
	var data_pane_count = 3; // TODO: Just 3 panes for now, could increase if more performance is needed
	var y_axis_offset = 30; // TODO: move these parameters to settings to make them adjustable
	var x_axis_offset = 70;
	var tick_size = 4;
	var axis_line_width = 1;
	if (this.settings && this.settings.Layout && this.settings.Layout.Controls && this.settings.Layout.Controls.location) {
		controls_location = this.settings.Layout.Controls.location;
	}
	var zoom = 1; // only x axis zoom level
	if (this.settings && this.settings.get_settings(["Zoom"]).Zoom) 
		zoom = this.settings.get_settings(["Zoom"]).Zoom;
	var chart_wrapper, chart_panel;
	if (controls_location == 'Left' || controls_location == 'Right')
		chart_wrapper = this.add_child_element(this.chart_container, 'div', 'chart_wrapper', 'Horizontal Wrapper', null);
	else
		chart_wrapper = this.add_child_element(this.chart_container, 'div', 'chart_wrapper', 'Vertical Wrapper', null);
	if (controls_location == 'Left' || controls_location == 'Top') { // FIXME: obviously hardcoded sequence of chart panels, should be dynamically managed instead
		this.add_child_element(chart_wrapper, 'div', 'toolbar', 'Toolbar', null);
		chart_panel = this.add_child_element(chart_wrapper, 'div', 'chart_panel', 'Resizable Container Panel', null);
	} else {
		chart_panel = this.add_child_element(chart_wrapper, 'div', 'chart_panel', 'Resizable Container Panel', null);
		this.add_child_element(chart_wrapper, 'div', 'toolbar', 'Toolbar', null);
	}
	this.add_chart_controls();
	// Layout to support x coordinate scroll, non-resizeable y axis and scrollable canvases
	var chart_container = this.add_child_element(chart_panel, 'div', 'chart_container', 'Horizontal Container', null);
	// Create y axis pane and draw axis on canvas using data
	var y_axis_pane = this.add_child_element(chart_container, 'div', 'y_axis_panel', 'MS Axis', null);
	//y_axis_pane.style.bottom = x_axis_offset + 'px';
	// Check if data has been loaded, if not then load first
	if (this.data == null || this.data.series.length == 0) {
		this.data.get_data();
	}
	var chart_pane_wrapper = this.add_child_element(chart_container, 'div', 'chart_pane_wrapper', 'Resizable Scrollable', null);
	var margin_left = tick_size + axis_line_width;
	chart_pane_wrapper.style.marginLeft = '-' + margin_left + 'px';
	this.draw_axis(y_axis_pane, 'Y', 5, tick_size, axis_line_width, y_axis_offset, x_axis_offset-2*tick_size, 'Left', false);
	var tick_label_precision = 0; // FIXME: needs to be put into settings
	var tick_labels = chart_container.querySelectorAll("#Y_axis_tick_label");
	var data_range = this.data.series[0].ymax - this.data.series[0].ymin;
	if (data_range && data_range > 0 && tick_labels && tick_labels.length > 0) {
		var tick_increment = data_range/(tick_labels.length+1); // FIXME: improve this crude method, including handling of axes ends
		for (var i=0; i<tick_labels.length; i++) {
			var tick_value = this.data.series[0].ymax - data_range * (i+1)/(tick_labels.length+1); 
			tick_labels[i].innerHTML = Number(tick_value.toFixed(tick_label_precision));
		}
	}
	this.update_chart_panel_size('chart_pane_wrapper');
	var chart = this;
	chart_pane_wrapper.addEventListener('scroll', function (event) {chart.track_scroll(chart, chart_pane_wrapper);});
	//chart_pane_wrapper.style.marginLeft = y_axis_offset + 'px';
	var chart_scroller = this.add_child_element(chart_pane_wrapper, 'div', 'chart_scroller', 'Scene', null);
	var chart_width = this.chart_panel_size.width * zoom;
	chart_scroller.style.display = 'inline-block';
	chart_scroller.style.width = chart_width + 'px';
	chart_scroller.style.height = "100%";
	for (var i = 0; i < data_pane_count; i++)
		this.data_panes[i] = this.create_data_pane(i+1, chart_scroller, x_axis_offset, y_axis_offset);
	var x_axis_label = this.add_child_element(chart_pane_wrapper, 'div', 'x_axis_label', 'X_Axis_Label', null);
	x_axis_label.style.bottom = 2*y_axis_offset/3 + 'px';
	x_axis_label.innerHTML = this.data.series[0].x_axis_label_text;
}

AS_JS_Chart_v1.Chart.prototype.create_data_pane = function(index, chart_scroller, x_axis_offset, y_axis_offset) {
	var tick_size = 6;
	var axis_line_width = 1;
	var data_pane = this.add_child_element(chart_scroller, 'div', 'data_pane_'+index, 'Vertical Fixed', null);
	data_pane.style.width = this.chart_panel_size.width + 'px';
	var graph_pane = this.add_child_element(data_pane, 'div', 'graph_pane', 'Resizeable Graph Pane', null);
	var x_axis_template = this.draw_axis(data_pane, 'X', 3, tick_size, axis_line_width, x_axis_offset, y_axis_offset, 'Bottom', false);
	x_axis_template.style.marginTop = '-' + tick_size + 'px';
	var canvas_settings = {};
	canvas_settings.width = graph_pane.offsetWidth;
	canvas_settings.height = graph_pane.offsetHeight;
	canvas = this.add_child_element(graph_pane, 'canvas', 'data_canvas', 'Data Canvas', canvas_settings);
	this.update_chart_panel_size('graph_pane');
	data_pane.classList.toggle('Template');
	return data_pane;
}

AS_JS_Chart_v1.Chart.prototype.update_chart_panel_size = function(panel_id) {
	//var chart_panel = this.chart_container.querySelector("#chart_pane_wrapper");
	var chart_panel = this.chart_container.querySelector("#"+panel_id); //"#graph_pane");
	if (chart_panel && chart_panel.offsetWidth > 0) {
		this.chart_panel_size.width = chart_panel.offsetWidth;
		this.chart_panel_size.height = chart_panel.offsetHeight;
		var ratio = this.ref_width/this.chart_panel_size.width;
		if (ratio > 1.5 || ratio < 0.7) { // if major resizing occured, redraw, otherwise let resizing take care of it
			this.ref_width = this.chart_panel_size.width;
			this.redraw_chart();
		} else { // for minor changes in size, just resize canvases without redraw
			this.resize_chart();
		}
	}
}


AS_JS_Chart_v1.Chart.prototype.redraw_chart = function() {
	//this.create_canvases();
	//this.show_data();
}

AS_JS_Chart_v1.Chart.prototype.resize_chart = function() {

}

AS_JS_Chart_v1.Chart.prototype.clone_canvas = function(template, new_id, container, copy_properties) {
	var old_canvas;
	var new_canvas;
	var old_wrapper;
	var new_wrapper;
	if (container && template && template.nodeName) {
		if (template.nodeName.toLowerCase() === 'canvas') {
			old_canvas = template;
		} else {
			old_wrapper = template;
			old_canvas = template.querySelector("canvas");
		}
		if (old_canvas) {
			if (old_wrapper) {
				new_wrapper = template.cloneNode(false);
				container.appendChild(new_wrapper);
			} else {
				new_wrapper = container;
			}
			if (copy_properties) {
				new_canvas = old_canvas.cloneNode(true);
				new_canvas.id = new_id;
				new_wrapper.appendChild(new_canvas);
			} else {
				new_canvas = this.add_child_element(new_wrapper, 'canvas', new_id, 'Canvas', null);
			}
			new_canvas.width = old_canvas.width;
			new_canvas.height = old_canvas.height;
			var context = new_canvas.getContext('2d');
			context.drawImage(old_canvas, 0, 0);
		}
	}
	return new_canvas;
}

AS_JS_Chart_v1.Chart.prototype.fill_parent = function(element) {
	element.style.width ='100%';
	element.style.height = '100%';
	element.width = element.offsetWidth;
	element.height = element.offsetHeight;
}

AS_JS_Chart_v1.Chart.prototype.get_new_window_container = function(width, height) { //TODO: to be implemented
	var container;
	var iframe = '<html><head><style>body, html {width: 100%; height: 100%; margin: 0; padding: 0}</style></head><body></body>';
	var new_window = window.open("","","width="+width+",height="+height+",toolbar=no,menubar=no,resizable=yes");
	new_window.document.write(iframe);
	return new_window.document.body;
}

AS_JS_Chart_v1.Chart.prototype.add_child_element = function(el_parent, el_type, el_id, el_class, el_attributes) {
	var new_element, parent;
	if (!el_parent || el_parent == null) 
		parent = document.body;
	else
		parent = el_parent;
	var element_type;
	if (el_type)
		element_type = el_type;
	else
		element_type = 'div'; // default
	new_element = document.createElement(element_type);
	new_element.id = el_id;
	new_element.className = el_class;
	this.set_element_attributes(new_element, el_attributes);
	parent.appendChild(new_element);
	return new_element;
}

AS_JS_Chart_v1.Chart.prototype.set_element_attributes = function(element, attributes) {
	if (element && attributes) {
		for (var attribute in attributes) {
			// element.setAttribute(attribute, attributes[attribute]); // shorthand that works for standard attributes only
			if (attribute == "type") {
				element.type = attributes[attribute];
			} else {
				var new_attribute = document.createAttribute(attribute); 
				new_attribute.value = attributes[attribute];
				element.setAttributeNode(new_attribute); // FIXME: test for case when element does not support setAttributeNode
			}
		}
	}
}

AS_JS_Chart_v1.Chart.prototype.add_chart_controls = function() { // FIXME: settings data structure has to change if multiple toolbar segments are needed 
	var toolbar = this.chart_container.querySelector("#toolbar");
	if (toolbar && this.settings) {
		var controls = this.settings.get_settings(["Controls"]).Controls;
		if (controls) {
			for (var i = 0; i < controls.length; i++) {
				this.add_control(toolbar, controls[i]);
			}
		}
	}
}

AS_JS_Chart_v1.Chart.prototype.add_control = function(toolbar, control_name) {
	var control_attributes = {};
	control_attributes.title = control_name;
	var control_wrapper = this.add_child_element(toolbar, 'div', control_name, 'Control', control_attributes);
	this.add_child_element(control_wrapper, 'input', 'control_checkbox', 'Toggle', {type: "checkbox", name: "control_checkbox", value: ""});
	this.add_child_element(control_wrapper, 'label', 'control_label', '', {for: "control_checkbox"});
}

AS_JS_Chart_v1.Chart.prototype.draw_axis = function(container, axis, n_ticks, tick_size, line_width, padding, offset, location, draw_grid) { //TODO: finish location and draw-grid implementations
	var axis_color = "#000000";
	if (container) {
		var axis_settings = {};
		if (axis == 'Y') {
			axis_settings.width = padding + tick_size + line_width;
			axis_settings.height = container.offsetHeight - offset;
			//container.style = "margin-right: -"+padding+"px;";
		} else {
			axis_settings.width = container.offsetWidth;
			axis_settings.height = padding - 2*tick_size;
		}
		var wrapper = this.add_child_element(container, 'div', axis+'_axis_container', 'Container Pane', null);
		wrapper.style.width = axis_settings.width + 'px';
		wrapper.style.height = axis_settings.height + 'px';
		var canvas = this.add_child_element(wrapper, 'canvas', axis+'_axis', 'Canvas '+axis+'_Axis', axis_settings);
        	var context = canvas.getContext('2d');
		context.beginPath();
		var offset = Math.ceil(tick_size/2) + line_width + 0.5; // FIXME: improve 0.5 pixel fix to remove fuzzy canvas line effects
		if (location == 'Left' || location == 'Top')
			offset = offset + padding;
		if (axis == 'Y') {
			offset = offset - tick_size + line_width;
          		context.moveTo(offset, 0); 
          		context.lineTo(offset, canvas.offsetHeight);
        	} else {
          		context.moveTo(0, offset);
          		context.lineTo(canvas.offsetWidth, offset);
		}
		this.draw_ticks(context, axis, axis_settings, offset, n_ticks, tick_size, wrapper, location, draw_grid);
		context.strokeStyle = axis_color;
		context.lineWidth = line_width;
		context.stroke();
		context.closePath();
	}
	return wrapper;
}

AS_JS_Chart_v1.Chart.prototype.draw_ticks = function(context, axis, axis_settings, offset, n_ticks, tick_size, wrapper, location, draw_grid) {
	var grid_color = "#CCCCCC"; // TODO: implement grid options
	var tick_label;
	if (context && axis_settings && n_ticks && n_ticks > 0) {
		var spacing;
		if (axis == 'Y') {
			// tick spacing
			spacing = Math.ceil(context.canvas.clientHeight/(n_ticks+1));
			for (i=1; i<=n_ticks; i++) {
    				context.moveTo(offset-tick_size, spacing*i-0.5);
    				context.lineTo(offset+tick_size, spacing*i-0.5);
				if (location == 'Left') {
					tick_label = this.add_child_element(wrapper, 'div', axis+'_axis_tick_label', 'Tick Label', null);
					tick_label.style.top = (spacing*i) + 'px';
					tick_label.style.right = (2*tick_size) + 'px';
				}
			}
			// draw axis origin to meet x-axis line
    			context.moveTo(offset, context.canvas.clientHeight-0.5);
    			context.lineTo(offset+tick_size, context.canvas.clientHeight-0.5);
        	} else {
			spacing = Math.ceil(context.canvas.clientWidth/(n_ticks+1));
			for (i=0; i<=n_ticks; i++) { 
    				context.moveTo(spacing*i+0.5, offset-tick_size);
    				context.lineTo(spacing*i+0.5, offset+tick_size);
				if (location == 'Bottom') {
					tick_label = this.add_child_element(wrapper, 'div', axis+'_axis_tick_label', 'Tick Label', null);
					tick_label.style.left = (spacing*i) + 'px';
					tick_label.style.top = (10+2*tick_size) + 'px';
				}
			}
		}
	}
}

// Data Class - Manages data for the Chart(s). Contains Data.Series Class for managing data series
AS_JS_Chart_v1.Data = function(settings) {
	this.settings = settings;
	this.series = []; // simplest data structure for now, x and y object fields without any compression
}

// Prototypical data getter function - in full implementation it should do AJAX to get data
AS_JS_Chart_v1.Data.prototype.get_data = function() {
	this.emulate_data(0, 100, 'Time', 0.001, 100, true);
}


// Prototypical data slicing function - in full implementation it should do AJAX to get data
AS_JS_Chart_v1.Data.prototype.get_data_segment = function(chart, data_segment_index, series_id) {
	var data_series = this.series[series_id];
	// FIXME: ignoring multiple series for now, need to implement
	var data_segment = [];
	var bin_counter = [];
	var zoom = 1;
	if (data_series) {
		var segment_pixel_size = chart.chart_panel_size.width;
		zoom = chart.settings.get_settings(["Zoom"]).Zoom;
		var y_scaling_factor = 1;
		var y_pixel_height = chart.chart_panel_size.height;
		if (y_pixel_height && y_pixel_height > 0 && data_series.ymax > data_series.ymin)
			y_scaling_factor = y_pixel_height/(data_series.ymax - data_series.ymin);
		var segment_size = (data_series.xmax - data_series.xmin)/zoom;
		var bin_size = segment_size/segment_pixel_size;
		// FIXME: assuming no missing data, need better range filtering
		var segment_datapoint_count = Math.ceil(data_series.data.length/zoom);
		var segment_start = Math.min(data_series.data.length-1, data_segment_index * segment_datapoint_count + 1);
		var segment_end = Math.min(data_series.data.length-1, segment_start + segment_datapoint_count);
		var bin_id;
		for (var i=segment_start; i <= segment_end; i++) {
			bin_id = Math.ceil((data_series.data[i].x - data_series.data[segment_start].x)/ bin_size);
			if (!bin_counter[bin_id]) {
				bin_counter[bin_id] = 1;
				data_segment[bin_id] = data_series.data[i].y;
			} else {
				bin_counter[bin_id] = bin_counter[bin_id] + 1;
				data_segment[bin_id] = data_segment[bin_id] + data_series.data[i].y;
			}
		}	
		for (var i=0; i<bin_counter.length; i++) // Average out for now
			if (bin_counter[i] > 0) // invert and move for canvas coordinates system
				data_segment[i] = Math.floor(y_pixel_height/2 - 0.5*y_scaling_factor * data_segment[i]/bin_counter[i]);
	}
	//alert(data_segment);
	return data_segment;
}

AS_JS_Chart_v1.Data.prototype.get_data_range = function(chart, data_segment_index, series_id) {
	var range;
	var zoom = 1;
	var data_series = this.series[series_id];
	if (data_series) {
		zoom = chart.settings.get_settings(["Zoom"]).Zoom;
		var segment_size = (data_series.xmax - data_series.xmin)/zoom;
		var segment_datapoint_count = Math.ceil(data_series.data.length/zoom);
		var segment_start = Math.min(data_series.data.length-1, data_segment_index * segment_datapoint_count + 1);
		var segment_end = Math.min(data_series.data.length-1, segment_start + segment_datapoint_count);
		range = data_series.data[segment_end].x - data_series.data[segment_start].x; // FIXME: assuming sorted x axis
	}
	return range;
}

AS_JS_Chart_v1.Data.prototype.emulate_data = function(xmin, xmax, x_axis_label_text, resolution, scale_factor, random_seed) {
	var x = xmin;
	var phase = 0;
	var data = [];
	var series = {};
	var ymin = 0, ymax = 0;
	if (random_seed)
		phase = Math.random() * 2 * Math.PI;
	while (x < xmax) {
		var data_point = {};
		data_point.x = x;
		data_point.y = Math.sin(2 * Math.PI * x + phase) * scale_factor;
		ymin = Math.min(ymin, data_point.y);
		ymax = Math.max(ymax, data_point.y);
		data.push(data_point);
		x = parseFloat((x + resolution).toFixed(4));
	}
	series.data = data;
	series.name = 'series ' + this.series.length;
	series.xmin = xmin;
	series.xmax = xmax;
	series.ymin = ymin;
	series.ymax = ymax;
	series.x_axis_label_text = x_axis_label_text;
	this.series.push(series);
}


